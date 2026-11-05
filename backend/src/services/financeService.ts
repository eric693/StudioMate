// 退費、會籍轉讓、預收款（履約保障）、定期定額、LINE Pay 訂單
import { Membership, PayMethod, Studio } from '@prisma/client';
import { prisma } from '../app';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, dateOnlyStr, localDate } from '../utils/time';
import { getStudio } from './studioService';
import { cancelBooking } from './bookingService';
import { notifyBookingChanges } from './notifyService';
import { notifyMember } from './lineService';
import { allowanceInvoice, cancelPeriod, invoiceCreds, payCreds, voidInvoice } from './ecpay';
import { linePayCreds, linePayRefund } from './linepay';
import { completeSale, issueMembershipInvoice } from './commerceService';

const daysBetween = (a: string, b: string) => Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400e3);

/* ---------- 方案價值：已使用與剩餘 ---------- */

/**
 * 依使用比例計算方案價值（退費、轉讓、預收款共用）：
 * 堂數卡／單堂＝金額 × 已用堂數 ÷ 總堂數；期限卡＝金額 × 已過天數 ÷ 總天數（凍結的天數不算使用，也不算在總天數）。
 */
export function membershipValue(ms: Membership, today: string, pendingCredits = 0) {
  const base = ms.valueBase ?? ms.price;
  let usedRatio: number;
  if (ms.kind === 'PERIOD') {
    const start = dateOnlyStr(ms.startDate), end = dateOnlyStr(ms.endDate);
    const frozenDays = (from: string, until: string) => {
      if (!ms.frozenFrom || !ms.frozenUntil) return 0;
      const f = dateOnlyStr(ms.frozenFrom) > from ? dateOnlyStr(ms.frozenFrom) : from;
      const u = dateOnlyStr(ms.frozenUntil) < until ? dateOnlyStr(ms.frozenUntil) : until;
      return u >= f ? daysBetween(f, u) + 1 : 0;
    };
    const total = Math.max(1, daysBetween(start, end) + 1 - frozenDays(start, end));
    const upTo = today < end ? today : end;
    const elapsed = today < start ? 0 : Math.max(0, daysBetween(start, upTo) + 1 - frozenDays(start, upTo));
    usedRatio = Math.min(1, elapsed / total);
  } else {
    const total = Math.max(1, ms.creditsTotal ?? 1);
    // 已預約但還沒上的課會在退費／轉讓時取消並退回堂數，不算已使用
    usedRatio = Math.min(1, Math.max(0, total - (ms.creditsLeft ?? 0) - pendingCredits) / total);
  }
  const used = Math.round(base * usedRatio);
  return { base, used, remaining: Math.max(0, base - used), usedRatio };
}

/* ---------- 退費 ---------- */

/** 未開始課程已扣的堂數（取消後會退回） */
async function pendingCredits(membershipId: string) {
  const r = await prisma.booking.aggregate({ where: { membershipId, status: 'BOOKED', session: { startsAt: { gt: new Date() } } }, _sum: { creditsCharged: true } });
  return r._sum.creditsCharged ?? 0;
}

export async function refundQuote(userId: string, membershipId: string) {
  const studio = await getStudio(userId);
  const ms = await prisma.membership.findFirst({ where: { id: membershipId, userId } });
  if (!ms) throw notFound('找不到方案');
  const pending = ms.kind === 'PERIOD' ? 0 : await pendingCredits(ms.id);
  const v = membershipValue(ms, localDate(new Date(), studio.timezone), pending);
  const fee = Math.round(v.remaining * studio.refundFeePercent / 100);
  return {
    membershipId: ms.id, planName: ms.planName, price: ms.price, base: v.base, used: v.used, remaining: v.remaining,
    feePercent: studio.refundFeePercent, fee, refund: Math.max(0, v.remaining - fee),
    usage: ms.kind === 'PERIOD' ? `已使用 ${Math.round(v.usedRatio * 100)}% 期間` : `已使用 ${(ms.creditsTotal ?? 0) - (ms.creditsLeft ?? 0) - pending} / ${ms.creditsTotal} 堂`,
    invoice: ms.invoiceStatus === 'ISSUED' ? ms.invoiceNo : null,
  };
}

/** 取消方案之後所有未開始的預約（釋出名額、遞補候補） */
async function cancelFutureBookings(userId: string, membershipId: string) {
  const future = await prisma.booking.findMany({
    where: { membershipId, status: { in: ['BOOKED', 'WAITLIST'] }, session: { startsAt: { gt: new Date() } } }, select: { id: true },
  });
  for (const b of future) {
    const r = await cancelBooking({ userId, bookingId: b.id, by: 'STAFF', forceRefund: true });
    if (r.promoted) await notifyBookingChanges(userId, [r.promoted]).catch(() => undefined);
  }
  return future.length;
}

/**
 * 退費解約：發票全額退作廢、部分退開折讓 → LINE Pay 訂單直接線上退款 → 取消未來預約 → 方案改為已退費 → 記錄退款。
 * 發票或線上退款失敗就整筆不處理，避免帳務不一致。
 */
export async function refundMembership(userId: string, membershipId: string, input: { amount?: number; method?: PayMethod; reason?: string; createdById?: string }) {
  const studio = await getStudio(userId);
  const ms = await prisma.membership.findFirst({ where: { id: membershipId, userId }, include: { member: true, order: true } });
  if (!ms) throw notFound('找不到方案');
  if (!['ACTIVE', 'FROZEN', 'EXPIRED'].includes(ms.status)) throw badRequest('這張方案已作廢、退費或轉讓，無法再退費');
  const q = await refundQuote(userId, ms.id);
  const amount = input.amount ?? q.refund;
  if (amount < 0 || amount > ms.price) throw badRequest(`退費金額須在 0 ~ ${ms.price} 之間`);

  let invoiceAction = 'NONE', allowanceNo: string | null = null;
  if (ms.invoiceStatus === 'ISSUED' && ms.invoiceNo && ms.invoiceDate && amount > 0) {
    try {
      if (amount >= ms.price) { await voidInvoice(invoiceCreds(studio), ms.invoiceNo, ms.invoiceDate, '退費解約'); invoiceAction = 'VOID'; }
      else { allowanceNo = await allowanceInvoice(invoiceCreds(studio), { invoiceNo: ms.invoiceNo, invoiceDate: ms.invoiceDate, amount, itemName: ms.planName, email: ms.member.email }); invoiceAction = 'ALLOWANCE'; }
    } catch (e) {
      throw badRequest(`發票${amount >= ms.price ? '作廢' : '折讓'}失敗：${(e as Error).message}`);
    }
  }
  let method = input.method ?? ms.payMethod;
  if (ms.order?.method === 'LINEPAY' && ms.order.providerTradeNo && amount > 0) {
    const c = linePayCreds(studio);
    if (c) {
      try { await linePayRefund(c, ms.order.providerTradeNo, amount); method = 'LINEPAY'; } catch (e) { throw badRequest(`LINE Pay 退款失敗：${(e as Error).message}`); }
    }
  }
  await cancelFutureBookings(userId, ms.id);
  if (ms.subscriptionId) await cancelSubscription(userId, ms.subscriptionId, '退費解約').catch((e) => console.error('[refund] cancel subscription', e));
  const [refund] = await prisma.$transaction([
    prisma.refund.create({
      data: { userId, memberId: ms.memberId, membershipId: ms.id, amount, usedValue: q.used, fee: Math.max(0, q.remaining - amount), method, reason: input.reason, allowanceNo, invoiceAction, createdById: input.createdById },
    }),
    prisma.membership.update({
      where: { id: ms.id },
      data: { status: 'REFUNDED', ...(invoiceAction === 'VOID' ? { invoiceStatus: 'VOID' } : {}), note: [ms.note, `退費 NT$${amount}${input.reason ? `（${input.reason}）` : ''}`].filter(Boolean).join('；') },
    }),
  ]);
  await notifyMember(userId, ms.memberId, 'REFUND', refund.id, `【${studio.name}】退費通知\n您的「${ms.planName}」已辦理解約退費 NT$${amount}${allowanceNo ? `，發票折讓單號 ${allowanceNo}` : ''}。`).catch(() => undefined);
  return refund;
}

/* ---------- 轉讓 ---------- */

/** 會籍轉讓：剩餘堂數／期限移給另一位會員（新方案沿用原到期日），原方案改為已轉讓。可收轉讓手續費（會開發票） */
export async function transferMembership(userId: string, membershipId: string, input: { toMemberId: string; fee?: number; payMethod?: PayMethod; note?: string }) {
  const studio = await getStudio(userId);
  const today = localDate(new Date(), studio.timezone);
  const found = await prisma.membership.findFirst({ where: { id: membershipId, userId } });
  if (!found) throw notFound('找不到方案');
  if (found.status !== 'ACTIVE') throw badRequest('只有使用中的方案可以轉讓（凍結中請先解除凍結）');
  const to = await prisma.member.findFirst({ where: { id: input.toMemberId, userId } });
  if (!to) throw notFound('找不到受讓的會員');
  if (to.id === found.memberId) throw badRequest('不能轉讓給自己');
  if (to.status !== 'ACTIVE') throw badRequest('受讓的會員已停用');
  // 先取消轉出人未開始的預約（退回堂數），再以最新堂數轉讓
  await cancelFutureBookings(userId, found.id);
  const ms = await prisma.membership.findUniqueOrThrow({ where: { id: found.id }, include: { member: true } });
  if (dateOnlyStr(ms.endDate) < today) throw badRequest('方案已過期，無法轉讓');
  if (ms.kind !== 'PERIOD' && (ms.creditsLeft ?? 0) <= 0) throw badRequest('方案已沒有剩餘堂數');
  const fee = input.fee ?? studio.transferFee;
  const v = membershipValue(ms, today);
  const created = await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: ms.id }, data: { status: 'TRANSFERRED', note: [ms.note, `轉讓給 ${to.name}（${today}）`].filter(Boolean).join('；') } });
    return tx.membership.create({
      data: {
        userId, memberId: to.id, planId: ms.planId, planName: ms.planName, kind: ms.kind,
        creditsTotal: ms.kind === 'PERIOD' ? null : ms.creditsLeft, creditsLeft: ms.kind === 'PERIOD' ? null : ms.creditsLeft,
        classTypeIds: ms.classTypeIds, dailyLimit: ms.dailyLimit,
        startDate: dateOnly(today > dateOnlyStr(ms.startDate) ? today : dateOnlyStr(ms.startDate)), endDate: ms.endDate,
        price: fee, payMethod: input.payMethod ?? 'CASH', valueBase: v.remaining, transferredFromId: ms.id,
        note: [`由 ${ms.member.name} 轉讓`, fee ? `手續費 NT$${fee}` : '', input.note].filter(Boolean).join('；'),
      },
    });
  });
  if (studio.invoiceEnabled && fee > 0) await issueMembershipInvoice(userId, created.id, `${ms.planName} 轉讓手續費`).catch(() => undefined);
  await notifyMember(userId, to.id, 'TRANSFER', created.id, `【${studio.name}】${ms.member.name} 已將「${ms.planName}」轉讓給您${ms.kind === 'PERIOD' ? '' : `，共 ${ms.creditsLeft} 堂`}，${dateOnlyStr(ms.endDate)} 到期，現在就可以預約。`).catch(() => undefined);
  return prisma.membership.findUniqueOrThrow({ where: { id: created.id } });
}

/* ---------- 預收款（履約保障） ---------- */

/** 尚未履約的預收款：所有有效方案的剩餘價值。教室向銀行申報信託或履約保證額度時使用 */
export async function deferredRevenue(userId: string) {
  const studio = await getStudio(userId);
  const today = localDate(new Date(), studio.timezone);
  const list = await prisma.membership.findMany({
    where: { userId, status: { in: ['ACTIVE', 'FROZEN'] }, endDate: { gte: dateOnly(today) } },
    include: { member: { select: { id: true, name: true, phone: true } } },
    orderBy: { endDate: 'asc' },
  });
  const rows = list.map((ms) => {
    const v = membershipValue(ms, today);
    return { id: ms.id, member: ms.member, planName: ms.planName, kind: ms.kind, paidAt: ms.paidAt, endDate: ms.endDate, base: v.base, used: v.used, remaining: v.remaining, creditsLeft: ms.creditsLeft };
  }).filter((r) => r.remaining > 0);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [collected, refunded] = await Promise.all([
    prisma.membership.aggregate({ where: { userId, paidAt: { gte: dateOnly(monthStart) }, status: { not: 'CANCELLED' } }, _sum: { price: true } }),
    prisma.refund.aggregate({ where: { userId, createdAt: { gte: dateOnly(monthStart) } }, _sum: { amount: true } }),
  ]);
  return {
    today, total: rows.reduce((a, r) => a + r.remaining, 0), count: rows.length,
    monthCollected: collected._sum.price ?? 0, monthRefunded: refunded._sum.amount ?? 0,
    trust: { type: studio.trustType, bank: studio.trustBank, note: studio.trustNote },
    rows,
  };
}

/* ---------- 定期定額 ---------- */

/** 首期付款完成：建立定期定額紀錄並連結首期方案 */
export async function startSubscription(order: { id: string; userId: string; memberId: string; planId: string; tradeNo: string; amount: number }, membershipId: string) {
  const sub = await prisma.subscription.create({
    data: { userId: order.userId, memberId: order.memberId, planId: order.planId, tradeNo: order.tradeNo, amount: order.amount, execTimes: 99, successTimes: 1, lastPaidAt: new Date() },
  });
  await prisma.membership.update({ where: { id: membershipId }, data: { subscriptionId: sub.id } });
  return sub;
}

/**
 * 綠界每期扣款結果。成功：新增一張方案，從上一期到期日隔天開始；失敗：標記扣款失敗並通知會員。
 * 以 TotalSuccessTimes 判斷是否已處理（綠界會重送通知）。
 */
export async function handlePeriodResult(p: Record<string, string>) {
  const sub = await prisma.subscription.findUnique({ where: { tradeNo: p.MerchantTradeNo }, include: { plan: true } });
  if (!sub) return { ok: false, reason: 'not found' };
  const studio = await getStudio(sub.userId);
  if (p.RtnCode === '1') {
    const n = Number(p.TotalSuccessTimes ?? 0);
    if (!n || n <= sub.successTimes) return { ok: true, duplicate: true };
    const claimed = await prisma.subscription.updateMany({ where: { id: sub.id, successTimes: sub.successTimes }, data: { successTimes: n } });
    if (!claimed.count) return { ok: true, duplicate: true };
    const last = await prisma.membership.findFirst({ where: { subscriptionId: sub.id }, orderBy: { endDate: 'desc' } });
    const today = localDate(new Date(), studio.timezone);
    const after = last ? addDays(dateOnlyStr(last.endDate), 1) : today;
    try {
      const ms = await completeSale(sub.userId, {
        memberId: sub.memberId, planId: sub.planId, price: sub.amount, payMethod: 'CARD',
        startDate: after > today ? after : today, note: `定期定額第 ${n} 期`,
      }, { quote: { coupon: null, discount: 0, amount: sub.amount } });
      await prisma.membership.update({ where: { id: ms.id }, data: { subscriptionId: sub.id } });
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: n >= sub.execTimes ? 'ENDED' : 'ACTIVE', failTimes: 0, lastPaidAt: new Date(), lastError: null },
      });
      await notifyMember(sub.userId, sub.memberId, 'SUBSCRIPTION', `${sub.id}:${n}`, `【${studio.name}】「${sub.plan.name}」第 ${n} 期自動扣款 NT$${sub.amount} 成功，方案已續約至 ${dateOnlyStr(ms.endDate)}。`).catch(() => undefined);
    } catch (e) {
      await prisma.subscription.update({ where: { id: sub.id }, data: { lastError: `扣款成功但續約失敗：${(e as Error).message}`.slice(0, 200) } });
    }
    return { ok: true };
  }
  const fails = sub.failTimes + 1;
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', failTimes: fails, lastError: (p.RtnMsg ?? '扣款失敗').slice(0, 200) } });
  await notifyMember(sub.userId, sub.memberId, 'SUBSCRIPTION', `${sub.id}:fail:${p.ProcessDate ?? fails}`,
    `【${studio.name}】「${sub.plan.name}」本期自動扣款失敗（${p.RtnMsg ?? '授權失敗'}），方案到期後將暫停。請確認信用卡狀態，或聯絡櫃檯更換付款方式。`).catch(() => undefined);
  return { ok: true };
}

/** 停止定期定額：通知綠界停止之後的扣款。綠界測試帳號無法停止時只在系統標記 */
export async function cancelSubscription(userId: string, id: string, reason = '') {
  const studio = await getStudio(userId);
  const sub = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!sub) throw notFound('找不到定期定額');
  if (sub.status === 'CANCELLED' || sub.status === 'ENDED') return sub;
  const c = payCreds(studio);
  try {
    await cancelPeriod(c, sub.tradeNo);
  } catch (e) {
    if (c.production) throw badRequest(`綠界停止扣款失敗：${(e as Error).message}`);
    console.warn('[subscription] 測試環境停止扣款失敗，僅標記取消', (e as Error).message);
  }
  return prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), lastError: reason || sub.lastError } });
}

export const studioHasTrust = (s: Studio) => Boolean(s.trustType && s.trustBank);
