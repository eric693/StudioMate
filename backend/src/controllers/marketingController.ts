// 行銷：會員名單篩選、群發 LINE 訊息、轉介紹
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { MemberRequest } from '../middleware/memberAuth';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, localDate } from '../utils/time';
import { getStudio } from '../services/studioService';
import { notifyMember } from '../services/lineService';
import { ensureReferralCode } from '../services/commerceService';

export const SEGMENTS = {
  inactive: '久未上課',
  expiring: '方案即將到期',
  lowCredit: '堂數快用完',
  noPass: '沒有有效方案',
  expired: '方案已過期未續約',
  birthday: '本月壽星',
  newMember: '新會員（未上過課）',
  all: '所有使用中會員',
} as const;
type Segment = keyof typeof SEGMENTS;

const segmentSchema = z.object({
  segment: z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]]),
  days: z.coerce.number().int().min(1).max(365).optional(), // inactive：幾天沒上課；expiring：幾天內到期；expired：過期幾天內
  lineOnly: z.coerce.boolean().optional(),
});

/** 依條件找出會員，附最後上課日與有效方案摘要 */
async function segmentMembers(userId: string, p: z.infer<typeof segmentSchema>) {
  const studio = await getStudio(userId);
  const today = localDate(new Date(), studio.timezone);
  const members = await prisma.member.findMany({
    where: { userId, status: 'ACTIVE', ...(p.lineOnly ? { lineUserId: { not: null } } : {}) },
    include: {
      memberships: { where: { status: { not: 'CANCELLED' } }, orderBy: { endDate: 'desc' } },
      bookings: { where: { status: 'ATTENDED' }, select: { session: { select: { startsAt: true } } }, orderBy: { session: { startsAt: 'desc' } }, take: 1 },
    },
  });
  const days = p.days;
  const active = (m: (typeof members)[number]) => m.memberships.filter((x) => ['ACTIVE', 'FROZEN'].includes(x.status) && x.endDate >= dateOnly(today));
  const month = today.slice(5, 7);
  const result = members.filter((m) => {
    const passes = active(m);
    const last = m.bookings[0]?.session.startsAt;
    switch (p.segment) {
      case 'inactive': return !last || last < new Date(Date.now() - (days ?? 30) * 86400e3);
      case 'expiring': return passes.some((x) => x.endDate <= dateOnly(addDays(today, days ?? 14)));
      case 'lowCredit': return passes.some((x) => x.kind !== 'PERIOD' && (x.creditsLeft ?? 0) <= studio.lowCreditThreshold);
      case 'noPass': return passes.length === 0;
      case 'expired': return passes.length === 0 && m.memberships.some((x) => x.endDate < dateOnly(today) && x.endDate >= dateOnly(addDays(today, -(days ?? 60))));
      case 'birthday': return m.birthday?.toISOString().slice(5, 7) === month;
      case 'newMember': return !last;
      default: return true;
    }
  });
  return result.map((m) => ({
    id: m.id, name: m.name, phone: m.phone, lineBound: !!m.lineUserId,
    lastAttended: m.bookings[0]?.session.startsAt ?? null,
    passes: active(m).map((x) => ({ planName: x.planName, kind: x.kind, creditsLeft: x.creditsLeft, endDate: x.endDate })),
  }));
}

export async function previewSegment(req: AuthRequest, res: Response) {
  const p = segmentSchema.parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  res.json(await segmentMembers(req.userId!, p));
}

/** 群發：訊息中的 {name} 會換成會員姓名。沒綁定 LINE 的會員略過；沙盒模式只記錄 */
export async function sendCampaign(req: AuthRequest, res: Response) {
  const d = segmentSchema.extend({
    name: z.string().trim().min(1, '請填寫活動名稱').max(60),
    message: z.string().trim().min(1, '請填寫訊息內容').max(1000),
    memberIds: z.array(z.string()).optional(), // 從預覽名單中勾選的會員；不填＝整個名單
  }).parse(req.body);
  let list = await segmentMembers(req.userId!, d);
  if (d.memberIds) list = list.filter((m) => d.memberIds!.includes(m.id));
  if (!list.length) throw badRequest('名單是空的');
  const c = await prisma.campaign.create({ data: { userId: req.userId!, name: d.name, segment: SEGMENTS[d.segment], message: d.message, total: list.length } });
  let sent = 0, sandbox = 0, skipped = 0;
  for (const m of list) {
    if (!m.lineBound) { skipped++; continue; }
    const r = await notifyMember(req.userId!, m.id, 'CAMPAIGN', c.id, d.message.replace(/\{name\}/g, m.name));
    if (r === 'sent') sent++; else if (r === 'sandbox') sandbox++; else skipped++;
  }
  res.status(201).json(await prisma.campaign.update({ where: { id: c.id }, data: { sent, sandbox, skipped } }));
}

export async function listCampaigns(req: AuthRequest, res: Response) {
  const q = String(req.query.q ?? '').trim();
  res.json(await prisma.campaign.findMany({
    where: { userId: req.userId!, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { message: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: { createdAt: 'desc' }, take: 200,
  }));
}

/** 刪除群發紀錄（只刪紀錄，已送出的訊息無法收回） */
export async function deleteCampaign(req: AuthRequest, res: Response) {
  const own = await prisma.campaign.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到群發紀錄');
  await prisma.campaign.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 轉介紹排行：每位介紹人介紹了誰、其中幾位已購買 */
export async function listReferrals(req: AuthRequest, res: Response) {
  const referred = await prisma.member.findMany({
    where: { userId: req.userId!, referredById: { not: null } },
    select: { id: true, name: true, createdAt: true, referredById: true, _count: { select: { memberships: { where: { status: { not: 'CANCELLED' } } } } } },
  });
  const ids = [...new Set(referred.map((r) => r.referredById!))];
  const referrers = await prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, referralCode: true } });
  res.json(referrers.map((r) => {
    const list = referred.filter((x) => x.referredById === r.id);
    return { ...r, count: list.length, converted: list.filter((x) => x._count.memberships > 0).length, referred: list.map((x) => ({ id: x.id, name: x.name, purchased: x._count.memberships > 0 })) };
  }).sort((a, b) => b.count - a.count));
}

/** 會員端：自己的推薦碼與介紹成果 */
export async function portalReferral(req: MemberRequest, res: Response) {
  const m = await prisma.member.findUnique({ where: { id: req.memberId! } });
  if (!m) throw notFound('找不到會員');
  const studio = await getStudio(m.userId);
  const code = await ensureReferralCode(m.id);
  const count = await prisma.member.count({ where: { referredById: m.id } });
  res.json({ code, count, reward: studio.referralRewardAmount });
}
