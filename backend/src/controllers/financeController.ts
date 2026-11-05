// 退費、轉讓、預收款報表、定期定額、電子合約
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { MemberRequest } from '../middleware/memberAuth';
import { notFound } from '../utils/http';
import { cancelSubscription, deferredRevenue, refundMembership, refundQuote, transferMembership } from '../services/financeService';
import { CONTRACT_VARS, DEFAULT_CONTRACT, createContract, renderContract } from '../services/contractService';
import { getStudio } from '../services/studioService';
import { dateOnlyStr } from '../utils/time';

const payMethod = z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']);

export async function getRefundQuote(req: AuthRequest, res: Response) {
  res.json(await refundQuote(req.userId!, req.params.id));
}

export async function postRefund(req: AuthRequest, res: Response) {
  const d = z.object({ amount: z.coerce.number().int().min(0).optional(), method: payMethod.optional(), reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  res.json(await refundMembership(req.userId!, req.params.id, { ...d, createdById: req.authUserId }));
}

export async function postTransfer(req: AuthRequest, res: Response) {
  const d = z.object({ toMemberId: z.string(), fee: z.coerce.number().int().min(0).max(100000).optional(), payMethod: payMethod.optional(), note: z.string().max(200).optional() }).parse(req.body);
  res.json(await transferMembership(req.userId!, req.params.id, d));
}

export async function listRefunds(req: AuthRequest, res: Response) {
  const list = await prisma.refund.findMany({
    where: { userId: req.userId! },
    include: { member: { select: { id: true, name: true, phone: true } }, membership: { select: { planName: true, price: true } } },
    orderBy: { createdAt: 'desc' }, take: 300,
  });
  res.json(list);
}

export async function getDeferred(req: AuthRequest, res: Response) {
  res.json(await deferredRevenue(req.userId!));
}

/* ---------- 定期定額 ---------- */

export async function listSubscriptions(req: AuthRequest, res: Response) {
  const status = z.enum(['ACTIVE', 'PAST_DUE', 'CANCELLED', 'ENDED']).optional().parse(req.query.status || undefined);
  res.json(await prisma.subscription.findMany({
    where: { userId: req.userId!, ...(status ? { status } : {}) },
    include: { member: { select: { id: true, name: true, phone: true } }, plan: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }, take: 300,
  }));
}

export async function staffCancelSubscription(req: AuthRequest, res: Response) {
  res.json(await cancelSubscription(req.userId!, req.params.id, '櫃檯停止'));
}

export async function portalSubscriptions(req: MemberRequest, res: Response) {
  res.json(await prisma.subscription.findMany({
    where: { memberId: req.memberId! }, include: { plan: { select: { name: true } } }, orderBy: { createdAt: 'desc' },
  }));
}

export async function portalCancelSubscription(req: MemberRequest, res: Response) {
  const sub = await prisma.subscription.findFirst({ where: { id: req.params.id, memberId: req.memberId! } });
  if (!sub) throw notFound('找不到定期定額');
  res.json(await cancelSubscription(sub.userId, sub.id, '會員自行停止'));
}

/* ---------- 電子合約 ---------- */

export async function contractTemplate(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  res.json({ enabled: studio.contractEnabled, text: studio.contractText ?? '', defaultText: DEFAULT_CONTRACT, vars: CONTRACT_VARS });
}

/** 櫃檯：依會員已購買的方案產生合約內容（簽署前預覽） */
export async function contractPreview(req: AuthRequest, res: Response) {
  const ms = await prisma.membership.findFirst({ where: { id: String(req.query.membershipId ?? ''), userId: req.userId! }, include: { member: true, plan: true } });
  if (!ms) throw notFound('找不到方案');
  const studio = await getStudio(req.userId!);
  res.json({ content: renderContract(studio, ms.member, ms.plan, ms.price, dateOnlyStr(ms.startDate)), title: `${ms.planName} 會員服務契約` });
}

/** 櫃檯簽約：會員在平板上手寫簽名 */
export async function signContract(req: AuthRequest, res: Response) {
  const d = z.object({ membershipId: z.string(), signature: z.string(), signerName: z.string().max(40) }).parse(req.body);
  const ms = await prisma.membership.findFirst({ where: { id: d.membershipId, userId: req.userId! }, include: { member: true, plan: true } });
  if (!ms) throw notFound('找不到方案');
  const studio = await getStudio(req.userId!);
  res.status(201).json(await createContract({
    userId: req.userId!, memberId: ms.memberId, membershipId: ms.id, title: `${ms.planName} 會員服務契約`,
    content: renderContract(studio, ms.member, ms.plan, ms.price, dateOnlyStr(ms.startDate)),
    signerName: d.signerName || ms.member.name, signature: d.signature, ip: req.ip, channel: 'FRONT_DESK',
  }));
}

export async function listContracts(req: AuthRequest, res: Response) {
  const memberId = req.query.memberId ? String(req.query.memberId) : undefined;
  res.json(await prisma.contract.findMany({
    where: { userId: req.userId!, ...(memberId ? { memberId } : {}) },
    select: { id: true, title: true, signerName: true, signedAt: true, channel: true, membershipId: true, member: { select: { id: true, name: true } } },
    orderBy: { signedAt: 'desc' }, take: 300,
  }));
}

export async function getContract(req: AuthRequest, res: Response) {
  const c = await prisma.contract.findFirst({ where: { id: req.params.id, userId: req.userId! }, include: { member: { select: { name: true, phone: true } } } });
  if (!c) throw notFound('找不到合約');
  res.json(c);
}

export async function portalContracts(req: MemberRequest, res: Response) {
  res.json(await prisma.contract.findMany({ where: { memberId: req.memberId! }, orderBy: { signedAt: 'desc' } }));
}
