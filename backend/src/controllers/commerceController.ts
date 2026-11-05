// 線上訂單、折價券、電子發票、綠界付款通知
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { MemberRequest } from '../middleware/memberAuth';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { buildCheckout, payCreds, verifyMac } from '../services/ecpay';
import { linePayConfirm, linePayCreds, linePayRequest } from '../services/linepay';
import { handlePeriodResult } from '../services/financeService';
import { createContract, renderContract } from '../services/contractService';
import { config } from '../config';
import {
  createOrder, fulfillOrder, issueMembershipInvoice, newTradeNo, paymentUrls, quoteCoupon, rejectOrder, voidMembershipInvoice, assertTrialAllowed,
} from '../services/commerceService';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');
const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined));

/* ---------- 後台：訂單 ---------- */

export async function listOrders(req: AuthRequest, res: Response) {
  const f = z.object({
    q: z.string().trim().optional(),
    status: z.enum(['PENDING', 'PAID', 'REJECTED', 'CANCELLED', 'FAILED']).optional(),
    method: z.enum(['ONLINE', 'TRANSFER', 'LINEPAY']).optional(),
  }).parse(clean(req.query));
  const orders = await prisma.order.findMany({
    where: {
      userId: req.userId!,
      ...(f.status ? { status: f.status } : {}),
      ...(f.method ? { method: f.method } : {}),
      ...(f.q ? { OR: [
        { tradeNo: { contains: f.q, mode: 'insensitive' as const } },
        { transferLast5: { contains: f.q } },
        { member: { name: { contains: f.q, mode: 'insensitive' as const } } },
        { member: { phone: { contains: f.q } } },
        { plan: { name: { contains: f.q, mode: 'insensitive' as const } } },
      ] } : {}),
    },
    include: { member: { select: { id: true, name: true, phone: true } }, plan: { select: { name: true } }, coupon: { select: { code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  res.json(orders);
}

export async function approveOrder(req: AuthRequest, res: Response) {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!o) throw notFound('找不到訂單');
  if (o.status !== 'PENDING') throw badRequest('只能審核待處理的訂單');
  if (o.method === 'TRANSFER' && !o.transferLast5) throw badRequest('會員尚未回報轉帳資料');
  res.json(await fulfillOrder(o.id));
}

export async function rejectOrderHandler(req: AuthRequest, res: Response) {
  const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
  res.json(await rejectOrder(req.userId!, req.params.id, reason ?? ''));
}

/** 刪除訂單：只限未付款（待處理、已退回、已取消、失敗）；已付款的訂單代表一筆收入，請到銷售紀錄作廢 */
export async function deleteOrder(req: AuthRequest, res: Response) {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!o) throw notFound('找不到訂單');
  if (o.status === 'PAID') throw badRequest('已付款的訂單不能刪除，請到銷售紀錄作廢方案');
  await prisma.order.delete({ where: { id: o.id } });
  res.json({ ok: true });
}

/* ---------- 後台：折價券 ---------- */

const couponSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/, '代碼只能用英數字、- 和 _').transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, '請填寫名稱').max(60),
  discountType: z.enum(['AMOUNT', 'PERCENT']),
  value: z.coerce.number().int().min(1),
  planIds: z.array(z.string()).optional(),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxUses: z.coerce.number().int().min(1).nullable().optional(),
  perMemberLimit: z.coerce.number().int().min(1).max(100).optional(),
  validFrom: day.nullable().optional(),
  validTo: day.nullable().optional(),
  newMemberOnly: z.boolean().optional(),
  active: z.boolean().optional(),
  note: z.string().max(200).nullable().optional(),
}).superRefine((c, ctx) => {
  if (c.discountType === 'PERCENT' && c.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: '折扣百分比不能超過 100' });
});
// 日期字串轉成資料庫日期，保留呼叫端的型別（新增時必填欄位、修改時部分欄位）
function couponData<T extends { validFrom?: string | null; validTo?: string | null }>(d: T) {
  const { validFrom, validTo, ...rest } = d;
  return {
    ...rest,
    ...(validFrom !== undefined ? { validFrom: validFrom ? dateOnly(validFrom) : null } : {}),
    ...(validTo !== undefined ? { validTo: validTo ? dateOnly(validTo) : null } : {}),
  };
}

export async function listCoupons(req: AuthRequest, res: Response) {
  const f = z.object({ q: z.string().trim().optional(), status: z.enum(['active', 'inactive', 'personal']).optional() }).parse(clean(req.query));
  const coupons = await prisma.coupon.findMany({
    where: {
      userId: req.userId!,
      ...(f.status === 'active' ? { active: true } : f.status === 'inactive' ? { active: false } : f.status === 'personal' ? { memberId: { not: null } } : {}),
      ...(f.q ? { OR: [{ code: { contains: f.q, mode: 'insensitive' as const } }, { name: { contains: f.q, mode: 'insensitive' as const } }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const memberIds = coupons.map((c) => c.memberId).filter((x): x is string => !!x);
  const names = Object.fromEntries((await prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  res.json(coupons.map((c) => ({ ...c, memberName: c.memberId ? names[c.memberId] ?? null : null })));
}
export async function createCoupon(req: AuthRequest, res: Response) {
  res.status(201).json(await prisma.coupon.create({ data: { ...couponData(couponSchema.parse(req.body)), userId: req.userId! } }));
}
export async function updateCoupon(req: AuthRequest, res: Response) {
  const own = await prisma.coupon.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到折價券');
  res.json(await prisma.coupon.update({ where: { id: own.id }, data: couponData(couponSchema.innerType().partial().parse(req.body)) }));
}
export async function deleteCoupon(req: AuthRequest, res: Response) {
  const own = await prisma.coupon.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到折價券');
  if (own.usedCount > 0) throw badRequest('這張折價券已被使用過，請改為停用以保留紀錄');
  await prisma.coupon.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 櫃檯售卡前試算折價券 */
export async function quoteCouponHandler(req: AuthRequest, res: Response) {
  const { memberId, planId, code } = z.object({ memberId: z.string(), planId: z.string(), code: z.string() }).parse(req.body);
  const plan = await prisma.plan.findFirst({ where: { id: planId, userId: req.userId! } });
  if (!plan) throw notFound('找不到方案');
  const q = await quoteCoupon(req.userId!, memberId, plan, code);
  res.json({ discount: q.discount, amount: q.amount, name: q.coupon?.name ?? null });
}

/* ---------- 後台：電子發票 ---------- */

export async function issueInvoiceHandler(req: AuthRequest, res: Response) {
  res.json(await issueMembershipInvoice(req.userId!, req.params.id));
}
export async function voidInvoiceHandler(req: AuthRequest, res: Response) {
  const { reason } = z.object({ reason: z.string().max(20).optional() }).parse(req.body ?? {});
  res.json(await voidMembershipInvoice(req.userId!, req.params.id, reason ?? '作廢'));
}

/* ---------- 綠界付款結果通知（伺服器對伺服器） ---------- */

export async function ecpayNotify(req: Request, res: Response) {
  const p = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)])) as Record<string, string>;
  const order = p.MerchantTradeNo ? await prisma.order.findUnique({ where: { tradeNo: p.MerchantTradeNo } }) : null;
  if (!order) { res.status(400).send('0|order not found'); return; }
  const studio = await getStudio(order.userId);
  if (!verifyMac(p, payCreds(studio))) { res.status(400).send('0|CheckMacValue error'); return; }
  if (Number(p.TradeAmt) !== order.amount) { res.status(400).send('0|amount mismatch'); return; }
  if (p.RtnCode === '1') {
    await fulfillOrder(order.id, { providerTradeNo: p.TradeNo, paymentType: p.PaymentType }).catch((e) => console.error('[ecpay] fulfill', e));
  } else if (order.status === 'PENDING') {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED', rejectReason: p.RtnMsg?.slice(0, 200) } });
  }
  res.send('1|OK');
}

/** 綠界定期定額：第二期起每期扣款結果通知 */
export async function ecpayPeriodNotify(req: Request, res: Response) {
  const p = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, String(v)])) as Record<string, string>;
  const sub = p.MerchantTradeNo ? await prisma.subscription.findUnique({ where: { tradeNo: p.MerchantTradeNo } }) : null;
  if (!sub) { res.status(400).send('0|subscription not found'); return; }
  if (!verifyMac(p, payCreds(await getStudio(sub.userId)))) { res.status(400).send('0|CheckMacValue error'); return; }
  await handlePeriodResult(p).catch((e) => console.error('[ecpay] period', e));
  res.send('1|OK');
}

/** LINE Pay 付款後導回：向 LINE Pay 確認扣款，成功就開通方案，再導回會員端 */
export async function linePayConfirmHandler(req: Request, res: Response) {
  const orderId = String(req.query.order ?? '');
  const transactionId = String(req.query.transactionId ?? '');
  const back = `${config.appUrl.replace(/\/$/, '')}/m?order=${encodeURIComponent(orderId)}`;
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o || o.method !== 'LINEPAY') { res.redirect(back); return; }
  if (o.status !== 'PENDING' || o.providerTradeNo !== transactionId) { res.redirect(back); return; }
  const c = linePayCreds(await getStudio(o.userId));
  try {
    if (!c) throw new Error('教室未設定 LINE Pay');
    await linePayConfirm(c, transactionId, o.amount);
    await fulfillOrder(o.id, { providerTradeNo: transactionId, paymentType: 'LINEPAY' });
  } catch (e) {
    console.error('[linepay] confirm', e);
    await prisma.order.updateMany({ where: { id: o.id, status: 'PENDING' }, data: { status: 'FAILED', rejectReason: (e as Error).message.slice(0, 200) } });
  }
  res.redirect(back);
}

/* ---------- 會員端：購買 ---------- */

async function portalMember(req: MemberRequest) {
  const m = await prisma.member.findUnique({ where: { id: req.memberId! } });
  if (!m || m.status !== 'ACTIVE') throw notFound('會員帳號不存在或已停用');
  return m;
}

/** 會員需同意最新版條款才能預約或購買（教室沒設定條款時不檢查） */
export async function assertTermsAccepted(memberId: string) {
  const m = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  const studio = await getStudio(m.userId);
  if (studio.terms && studio.termsVersion > m.termsAcceptedVersion) throw badRequest('請先閱讀並同意教室的會員條款');
}

export async function portalShop(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const studio = await getStudio(m.userId);
  const [plans, purchased, types] = await Promise.all([
    prisma.plan.findMany({ where: { userId: m.userId, active: true, onlineSale: true }, orderBy: { price: 'asc' } }),
    prisma.membership.count({ where: { memberId: m.id, status: { not: 'CANCELLED' } } }),
    prisma.classType.findMany({ where: { userId: m.userId }, select: { id: true, name: true } }),
  ]);
  const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
  res.json({
    onlinePay: studio.onlinePayEnabled, transfer: studio.transferEnabled, bankInfo: studio.transferEnabled ? studio.bankInfo : null,
    linePay: Boolean(studio.linePayEnabled && linePayCreds(studio)), linePayTest: studio.linePayMode !== 'production',
    installments: studio.installments || null, installmentMin: studio.installmentMin,
    trust: studio.trustType && studio.trustBank ? { type: studio.trustType, bank: studio.trustBank, note: studio.trustNote } : null,
    contractRequired: studio.contractEnabled,
    testMode: payCreds(studio).production === false,
    plans: plans.filter((p) => !p.trialOnly || purchased === 0).map((p) => ({
      id: p.id, name: p.name, kind: p.kind, credits: p.credits, validDays: p.validDays, price: p.price, description: p.description,
      dailyLimit: p.dailyLimit, trialOnly: p.trialOnly, classTypes: p.classTypeIds.map((i) => typeName[i]).filter(Boolean), recurring: p.recurring,
    })),
  });
}

export async function portalQuote(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const { planId, code } = z.object({ planId: z.string(), code: z.string() }).parse(req.body);
  const plan = await prisma.plan.findFirst({ where: { id: planId, userId: m.userId, active: true, onlineSale: true } });
  if (!plan) throw notFound('找不到方案');
  await assertTrialAllowed(m.id, plan);
  const q = await quoteCoupon(m.userId, m.id, plan, code);
  res.json({ discount: q.discount, amount: q.amount, name: q.coupon?.name ?? null });
}

/** 會員端：預覽要簽署的合約內容 */
export async function portalContractPreview(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const studio = await getStudio(m.userId);
  const plan = await prisma.plan.findFirst({ where: { id: String(req.query.planId ?? ''), userId: m.userId, active: true, onlineSale: true } });
  if (!plan) throw notFound('找不到方案');
  const q = await quoteCoupon(m.userId, m.id, plan, String(req.query.code ?? '') || null).catch(() => ({ amount: plan.price }));
  res.json({ required: studio.contractEnabled, content: renderContract(studio, m, plan, q.amount) });
}

export async function portalCreateOrder(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  await assertTermsAccepted(m.id);
  const d = z.object({
    planId: z.string(), method: z.enum(['ONLINE', 'TRANSFER', 'LINEPAY']), couponCode: z.string().optional().nullable(), recurring: z.boolean().optional(),
    signature: z.string().optional(), signerName: z.string().max(40).optional(),
  }).parse(req.body);
  const studio = await getStudio(m.userId);
  let contractId: string | null = null;
  if (studio.contractEnabled) {
    if (!d.signature) throw badRequest('請先簽署合約');
    const plan = await prisma.plan.findFirst({ where: { id: d.planId, userId: m.userId } });
    if (!plan) throw notFound('找不到方案');
    const q = await quoteCoupon(m.userId, m.id, plan, d.couponCode);
    const c = await createContract({
      userId: m.userId, memberId: m.id, title: `${plan.name} 會員服務契約`, content: renderContract(studio, m, plan, q.amount),
      signerName: d.signerName || m.name, signature: d.signature, ip: req.ip, channel: 'ONLINE',
    });
    contractId = c.id;
  }
  const order = await createOrder(m.userId, m.id, d);
  if (contractId) await prisma.order.update({ where: { id: order.id }, data: { contractId } });
  // 折價券折到 0 元：不用付款，直接完成
  if (order.amount === 0) { res.status(201).json({ order: await fulfillOrder(order.id), free: true }); return; }
  res.status(201).json({ order });
}

/** 取得導向綠界的付款表單（每次重新產生，交易時間才會是最新的） */
export async function portalPayForm(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const o = await prisma.order.findFirst({ where: { id: req.params.id, memberId: m.id }, include: { plan: true } });
  if (!o) throw notFound('找不到訂單');
  if (o.method !== 'ONLINE' || o.status !== 'PENDING') throw badRequest('這筆訂單不需要線上付款');
  const studio = await getStudio(m.userId);
  // 綠界同一個交易編號只能送一次：重新付款時換一個編號
  const tradeNo = newTradeNo();
  await prisma.order.update({ where: { id: o.id }, data: { tradeNo } });
  const urls = paymentUrls(o.id);
  const installments = !o.recurring && studio.installments && o.amount >= studio.installmentMin ? studio.installments : null;
  res.json(buildCheckout(payCreds(studio), {
    tradeNo, amount: o.amount, itemName: `${studio.name} ${o.plan.name}`, notifyUrl: urls.notifyUrl, backUrl: urls.backUrl,
    installments, period: o.recurring ? { execTimes: 99, periodUrl: urls.periodUrl } : null,
  }));
}

/** LINE Pay：建立付款請求，回傳要導向的付款網址 */
export async function portalLinePay(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const o = await prisma.order.findFirst({ where: { id: req.params.id, memberId: m.id }, include: { plan: true } });
  if (!o) throw notFound('找不到訂單');
  if (o.method !== 'LINEPAY' || o.status !== 'PENDING') throw badRequest('這筆訂單不需要 LINE Pay 付款');
  const studio = await getStudio(m.userId);
  const c = linePayCreds(studio);
  if (!c || !studio.linePayEnabled) throw badRequest('教室尚未開放 LINE Pay 付款');
  const tradeNo = newTradeNo();
  const urls = paymentUrls(o.id);
  try {
    const r = await linePayRequest(c, { orderId: tradeNo, amount: o.amount, name: `${studio.name} ${o.plan.name}`, confirmUrl: urls.linePayConfirmUrl, cancelUrl: urls.backUrl });
    await prisma.order.update({ where: { id: o.id }, data: { tradeNo, providerTradeNo: r.transactionId } });
    res.json({ url: r.url });
  } catch (e) {
    throw badRequest((e as Error).message);
  }
}

export async function portalSubmitTransfer(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const d = z.object({ last5: z.string().regex(/^\d{5}$/, '請輸入帳號後五碼'), transferAt: day.optional() }).parse(req.body);
  const o = await prisma.order.findFirst({ where: { id: req.params.id, memberId: m.id } });
  if (!o) throw notFound('找不到訂單');
  if (o.method !== 'TRANSFER' || o.status !== 'PENDING') throw badRequest('這筆訂單無法回報轉帳');
  const studio = await getStudio(m.userId);
  res.json(await prisma.order.update({
    where: { id: o.id },
    data: { transferLast5: d.last5, transferAt: d.transferAt ? localToUtc(d.transferAt, '12:00', studio.timezone) : new Date() },
  }));
}

export async function portalCancelOrder(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const o = await prisma.order.findFirst({ where: { id: req.params.id, memberId: m.id } });
  if (!o) throw notFound('找不到訂單');
  if (o.status !== 'PENDING') throw badRequest('只能取消待處理的訂單');
  res.json(await prisma.order.update({ where: { id: o.id }, data: { status: 'CANCELLED' } }));
}

export async function portalOrders(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  res.json(await prisma.order.findMany({
    where: { memberId: m.id, createdAt: { gte: new Date(Date.now() - 180 * 86400e3) } },
    include: { plan: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  }));
}

/** 會員自己的折價券（指定給自己的、還沒用完的） */
export async function portalCoupons(req: MemberRequest, res: Response) {
  const m = await portalMember(req);
  const today = addDays(new Date().toISOString().slice(0, 10), 0);
  const list = await prisma.coupon.findMany({ where: { userId: m.userId, memberId: m.id, active: true } });
  const used = await prisma.couponRedemption.groupBy({ by: ['couponId'], where: { memberId: m.id, couponId: { in: list.map((c) => c.id) } }, _count: true });
  const usedMap = Object.fromEntries(used.map((u) => [u.couponId, u._count]));
  res.json(list.filter((c) => (usedMap[c.id] ?? 0) < c.perMemberLimit && (!c.validTo || c.validTo.toISOString().slice(0, 10) >= today))
    .map((c) => ({ code: c.code, name: c.name, discountType: c.discountType, value: c.value, validTo: c.validTo })));
}
