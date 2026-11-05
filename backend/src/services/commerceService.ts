// 售卡相關的商業邏輯：折價券、轉介紹獎勵、電子發票、線上訂單（綠界／轉帳）
import crypto from 'crypto';
import { Coupon, Membership, PayMethod, Plan, Prisma } from '@prisma/client';
import { prisma } from '../app';
import { badRequest, conflict, notFound } from '../utils/http';
import { dateOnly, localDate } from '../utils/time';
import { getStudio } from './studioService';
import { sellMembership } from './membershipService';
import { invoiceCreds, issueInvoice, voidInvoice } from './ecpay';
import { notifyMember } from './lineService';
import { config } from '../config';

/* ---------- 折價券 ---------- */

export interface CouponQuote { coupon: Coupon | null; discount: number; amount: number }

/** 檢查折價券能否用在這位會員、這個方案，回傳折抵後金額。沒有代碼時原價 */
export async function quoteCoupon(userId: string, memberId: string, plan: Plan, code?: string | null, basePrice = plan.price): Promise<CouponQuote> {
  const c = code?.trim().toUpperCase();
  if (!c) return { coupon: null, discount: 0, amount: basePrice };
  const coupon = await prisma.coupon.findUnique({ where: { userId_code: { userId, code: c } } });
  if (!coupon || !coupon.active) throw badRequest('折價券代碼無效');
  const studio = await getStudio(userId);
  const today = localDate(new Date(), studio.timezone);
  if (coupon.validFrom && today < coupon.validFrom.toISOString().slice(0, 10)) throw badRequest('折價券還沒開始使用');
  if (coupon.validTo && today > coupon.validTo.toISOString().slice(0, 10)) throw badRequest('折價券已過期');
  if (coupon.memberId && coupon.memberId !== memberId) throw badRequest('這張折價券限指定會員使用');
  if (coupon.planIds.length && !coupon.planIds.includes(plan.id)) throw badRequest('這張折價券不適用此方案');
  if (basePrice < coupon.minAmount) throw badRequest(`消費滿 NT$${coupon.minAmount} 才能使用`);
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) throw badRequest('折價券已被用完');
  if (await prisma.couponRedemption.count({ where: { couponId: coupon.id, memberId } }) >= coupon.perMemberLimit) throw badRequest('您已使用過這張折價券');
  if (coupon.newMemberOnly && await prisma.membership.count({ where: { memberId, status: { not: 'CANCELLED' } } })) throw badRequest('這張折價券限首次購買使用');
  const discount = Math.min(basePrice, coupon.discountType === 'AMOUNT' ? coupon.value : Math.round(basePrice * coupon.value / 100));
  return { coupon, discount, amount: basePrice - discount };
}

/** 體驗方案限沒有購買紀錄的會員購買一次 */
export async function assertTrialAllowed(memberId: string, plan: Plan) {
  if (!plan.trialOnly) return;
  if (await prisma.membership.count({ where: { memberId, status: { not: 'CANCELLED' } } })) throw badRequest('體驗方案限首次購買的會員');
}

/* ---------- 售卡（櫃檯與線上共用） ---------- */

export interface SaleInput {
  memberId: string; planId: string; startDate?: string; price?: number; payMethod?: PayMethod; note?: string; couponCode?: string | null;
}

/**
 * 完整售卡流程：體驗方案檢查 → 折價券 → 建立方案 → 記錄折價券使用 → 轉介紹獎勵 → 開立發票。
 * 櫃檯手動改過實收金額時以輸入為準（折價券只記錄使用，不再重複折抵）。
 */
export async function completeSale(userId: string, input: SaleInput, opts: { quote?: CouponQuote } = {}) {
  const plan = await prisma.plan.findFirst({ where: { id: input.planId, userId } });
  if (!plan) throw notFound('找不到方案');
  await assertTrialAllowed(input.memberId, plan);
  const quote = opts.quote ?? await quoteCoupon(userId, input.memberId, plan, input.couponCode);
  const isFirstPurchase = !(await prisma.membership.count({ where: { memberId: input.memberId, status: { not: 'CANCELLED' } } }));
  // 有折價券但櫃檯沒改實收金額（仍是原價）時，自動套用折抵後的金額
  const price = input.price === undefined || (quote.coupon && input.price === plan.price) ? quote.amount : input.price;
  const ms = await sellMembership(userId, { ...input, price });
  if (quote.coupon) {
    await prisma.$transaction([
      prisma.membership.update({ where: { id: ms.id }, data: { couponId: quote.coupon.id, discount: quote.discount } }),
      prisma.couponRedemption.create({ data: { userId, couponId: quote.coupon.id, memberId: input.memberId, membershipId: ms.id, discount: quote.discount } }),
      prisma.coupon.update({ where: { id: quote.coupon.id }, data: { usedCount: { increment: 1 } } }),
    ]);
  }
  if (isFirstPurchase) await rewardReferrer(userId, input.memberId).catch((e) => console.error('[referral]', e));
  const studio = await getStudio(userId);
  if (studio.invoiceEnabled && ms.price > 0) await issueMembershipInvoice(userId, ms.id).catch(() => undefined);
  return prisma.membership.findUniqueOrThrow({ where: { id: ms.id } });
}

/* ---------- 轉介紹 ---------- */

export async function ensureReferralCode(memberId: string) {
  const m = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (m.referralCode) return m.referralCode;
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 5; i++) {
    const code = 'R' + Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
    try {
      await prisma.member.update({ where: { id: memberId }, data: { referralCode: code } });
      return code;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  throw new Error('無法產生推薦碼');
}

/** 被介紹的會員首次購買後，發一張專屬折價券給介紹人並通知 */
async function rewardReferrer(userId: string, memberId: string) {
  const studio = await getStudio(userId);
  if (!studio.referralRewardAmount) return;
  const m = await prisma.member.findUnique({ where: { id: memberId }, include: { referredBy: true } });
  if (!m?.referredBy || m.referredBy.userId !== userId) return;
  const code = `REF${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const coupon = await prisma.coupon.create({
    data: {
      userId, code, name: `轉介紹獎勵（介紹 ${m.name}）`, discountType: 'AMOUNT', value: studio.referralRewardAmount,
      memberId: m.referredBy.id, perMemberLimit: 1, maxUses: 1, note: `介紹 ${m.name} 首次購買`,
    },
  });
  await notifyMember(userId, m.referredBy.id, 'REFERRAL', coupon.id,
    `感謝您介紹 ${m.name} 加入${studio.name}！送您 NT$${studio.referralRewardAmount} 折價券，購買方案時輸入代碼 ${code} 即可折抵。`);
}

/* ---------- 電子發票 ---------- */

export async function issueMembershipInvoice(userId: string, membershipId: string, itemName?: string) {
  const ms = await prisma.membership.findFirst({ where: { id: membershipId, userId }, include: { member: true } });
  if (!ms) throw notFound('找不到方案');
  if (ms.invoiceStatus === 'ISSUED') throw conflict('這筆已經開立發票');
  if (ms.price <= 0) throw badRequest('金額為 0 不需開立發票');
  const studio = await getStudio(userId);
  try {
    const r = await issueInvoice(invoiceCreds(studio), {
      relateNumber: `SM${ms.id.slice(-12)}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 30),
      amount: ms.price,
      itemName: itemName ?? ms.planName,
      buyer: {
        name: ms.member.name, email: ms.member.email, phone: ms.member.phone,
        carrierType: ms.member.invoiceCarrierType, carrierNum: ms.member.invoiceCarrierNum, taxId: ms.member.invoiceTaxId, title: ms.member.invoiceTitle,
      },
    });
    return prisma.membership.update({
      where: { id: ms.id },
      data: { invoiceNo: r.invoiceNo, invoiceDate: new Date(r.invoiceDate.replace('+', 'T') + '+08:00'), invoiceRandom: r.random, invoiceStatus: 'ISSUED', invoiceError: null },
    });
  } catch (e) {
    await prisma.membership.update({ where: { id: ms.id }, data: { invoiceStatus: 'FAILED', invoiceError: (e as Error).message.slice(0, 200) } });
    throw badRequest(`發票開立失敗：${(e as Error).message}`);
  }
}

export async function voidMembershipInvoice(userId: string, membershipId: string, reason: string) {
  const ms = await prisma.membership.findFirst({ where: { id: membershipId, userId } });
  if (!ms) throw notFound('找不到方案');
  if (ms.invoiceStatus !== 'ISSUED' || !ms.invoiceNo || !ms.invoiceDate) throw badRequest('這筆沒有已開立的發票');
  const studio = await getStudio(userId);
  try {
    await voidInvoice(invoiceCreds(studio), ms.invoiceNo, ms.invoiceDate, reason);
  } catch (e) {
    throw badRequest(`發票作廢失敗：${(e as Error).message}`);
  }
  return prisma.membership.update({ where: { id: ms.id }, data: { invoiceStatus: 'VOID' } });
}

/* ---------- 線上訂單 ---------- */

export const newTradeNo = () => `SM${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 20);

/** 會員下單：檢查方案開放線上購買、付款方式已啟用、體驗方案與折價券；同時只能有一筆待處理的同方案訂單 */
export async function createOrder(userId: string, memberId: string, input: { planId: string; method: 'ONLINE' | 'TRANSFER' | 'LINEPAY'; couponCode?: string | null; recurring?: boolean }) {
  const studio = await getStudio(userId);
  const plan = await prisma.plan.findFirst({ where: { id: input.planId, userId, active: true, onlineSale: true } });
  if (!plan) throw notFound('這個方案沒有開放線上購買');
  if (input.method === 'ONLINE' && !studio.onlinePayEnabled) throw badRequest('教室尚未開放線上付款');
  if (input.method === 'TRANSFER' && !studio.transferEnabled) throw badRequest('教室尚未開放轉帳付款');
  if (input.method === 'LINEPAY' && !(studio.linePayEnabled && studio.linePayChannelId && studio.linePaySecret)) throw badRequest('教室尚未開放 LINE Pay 付款');
  const recurring = Boolean(input.recurring && plan.recurring);
  if (input.recurring && !plan.recurring) throw badRequest('這個方案沒有開放定期定額');
  if (recurring && input.method !== 'ONLINE') throw badRequest('定期定額只能用信用卡付款');
  if (recurring && input.couponCode) throw badRequest('定期定額方案不能使用折價券');
  await assertTrialAllowed(memberId, plan);
  const quote = await quoteCoupon(userId, memberId, plan, input.couponCode);
  // 舊的未付款線上訂單直接作廢，避免重複
  await prisma.order.updateMany({ where: { memberId, planId: plan.id, status: 'PENDING', method: { in: ['ONLINE', 'LINEPAY'] } }, data: { status: 'CANCELLED' } });
  return prisma.order.create({
    data: {
      userId, memberId, planId: plan.id, tradeNo: newTradeNo(), method: input.method,
      originalAmount: plan.price, discount: quote.discount, amount: quote.amount, couponId: quote.coupon?.id ?? null, recurring,
    },
    include: { plan: true },
  });
}

/** 訂單付款完成（綠界通知或櫃檯審核轉帳）：建立方案。用條件更新確保只會建立一次 */
export async function fulfillOrder(orderId: string, info: { providerTradeNo?: string; paymentType?: string } = {}) {
  const claimed = await prisma.order.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date(), ...info } });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { coupon: true, plan: true } });
  if (!claimed.count) return order; // 已處理過（綠界會重送通知）
  let ms: Membership;
  try {
    ms = await completeSale(order.userId, {
      memberId: order.memberId, planId: order.planId, price: order.amount,
      payMethod: order.method === 'TRANSFER' ? 'TRANSFER' : order.method === 'LINEPAY' ? 'LINEPAY' : 'CARD',
      note: `${order.recurring ? '定期定額首期・' : ''}線上訂單 ${order.tradeNo}`,
    }, { quote: { coupon: order.coupon, discount: order.discount, amount: order.amount } });
  } catch (e) {
    // 付款已完成但建立方案失敗（例如方案剛被停售）：保留為已付款並記錄，由櫃檯手動處理
    await prisma.order.update({ where: { id: order.id }, data: { rejectReason: `已付款，建立方案失敗：${(e as Error).message}` } });
    throw e;
  }
  const done = await prisma.order.update({ where: { id: order.id }, data: { membershipId: ms.id } });
  if (order.contractId) await prisma.contract.updateMany({ where: { id: order.contractId, membershipId: null }, data: { membershipId: ms.id } });
  if (order.recurring) {
    const { startSubscription } = await import('./financeService');
    await startSubscription(order, ms.id).catch((e) => console.error('[subscription] start', e));
  }
  const studio = await getStudio(order.userId);
  await notifyMember(order.userId, order.memberId, 'ORDER_PAID', order.id,
    `付款完成！「${order.plan.name}」已加入您的帳戶，現在就可以預約課程。— ${studio.name}`).catch(() => undefined);
  return done;
}

export async function rejectOrder(userId: string, orderId: string, reason: string) {
  const o = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { plan: true } });
  if (!o) throw notFound('找不到訂單');
  if (o.status !== 'PENDING') throw badRequest('只能退回待處理的訂單');
  const done = await prisma.order.update({ where: { id: o.id }, data: { status: 'REJECTED', rejectReason: reason || null } });
  await notifyMember(userId, o.memberId, 'ORDER_REJECTED', o.id, `您購買「${o.plan.name}」的轉帳未通過審核${reason ? `：${reason}` : ''}。如有疑問請聯絡教室。`).catch(() => undefined);
  return done;
}

const base = () => config.appUrl.replace(/\/$/, '');
export const paymentUrls = (orderId: string) => ({
  notifyUrl: `${base()}/api/pay/ecpay/notify`,
  backUrl: `${base()}/m?order=${orderId}`,
  periodUrl: `${base()}/api/pay/ecpay/period`,
  linePayConfirmUrl: `${base()}/api/pay/linepay/confirm?order=${orderId}`,
});

export const todayDate = async (userId: string) => dateOnly(localDate(new Date(), (await getStudio(userId)).timezone));
