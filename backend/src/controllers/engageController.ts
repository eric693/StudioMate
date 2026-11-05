// 公告、滿意度問卷、營運分析（續約率、流失、熱門時段、課程與教練排行）
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { MemberRequest } from '../middleware/memberAuth';
import { badRequest, notFound } from '../utils/http';
import { dateOnly, dateOnlyStr, localDate, localToUtc, zonedParts } from '../utils/time';
import { getStudio } from '../services/studioService';
import { notifyMember } from '../services/lineService';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');

/* ---------- 公告 ---------- */

export async function listAnnouncements(req: AuthRequest, res: Response) {
  res.json(await prisma.announcement.findMany({ where: { userId: req.userId! }, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 200 }));
}

/** 發布公告；push＝true 時同時用 LINE 推播給所有已綁定的使用中會員 */
export async function createAnnouncement(req: AuthRequest, res: Response) {
  const d = z.object({
    title: z.string().trim().min(1, '請填寫標題').max(60), body: z.string().trim().min(1, '請填寫內容').max(2000),
    pinned: z.boolean().optional(), expiresAt: day.nullable().optional(), push: z.boolean().optional(),
  }).parse(req.body);
  const { push, expiresAt, ...rest } = d;
  const a = await prisma.announcement.create({ data: { ...rest, expiresAt: expiresAt ? dateOnly(expiresAt) : null, userId: req.userId! } });
  if (!push) { res.status(201).json(a); return; }
  const studio = await getStudio(req.userId!);
  const members = await prisma.member.findMany({ where: { userId: req.userId!, status: 'ACTIVE', OR: [{ lineUserId: { not: null } }, { pushSubs: { some: {} } }] }, select: { id: true } });
  let pushed = 0;
  for (const m of members) {
    const r = await notifyMember(req.userId!, m.id, 'ANNOUNCEMENT', a.id, `【${studio.name}】${a.title}\n${a.body}`);
    if (r === 'sent' || r === 'sandbox') pushed++;
  }
  res.status(201).json(await prisma.announcement.update({ where: { id: a.id }, data: { pushed } }));
}

export async function updateAnnouncement(req: AuthRequest, res: Response) {
  const own = await prisma.announcement.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到公告');
  const d = z.object({ title: z.string().trim().min(1).max(60).optional(), body: z.string().trim().min(1).max(2000).optional(), pinned: z.boolean().optional(), expiresAt: day.nullable().optional() }).parse(req.body);
  res.json(await prisma.announcement.update({ where: { id: own.id }, data: { ...d, ...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt ? dateOnly(d.expiresAt) : null } : {}) } }));
}

export async function deleteAnnouncement(req: AuthRequest, res: Response) {
  const own = await prisma.announcement.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到公告');
  await prisma.announcement.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

export async function portalAnnouncements(req: MemberRequest, res: Response) {
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.memberId! } });
  const studio = await getStudio(m.userId);
  const today = dateOnly(localDate(new Date(), studio.timezone));
  res.json(await prisma.announcement.findMany({
    where: { userId: m.userId, OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], take: 20,
  }));
}

/* ---------- 問卷 ---------- */

const questionSchema = z.object({
  id: z.string().min(1).max(20),
  type: z.enum(['rating', 'text', 'choice']),
  label: z.string().trim().min(1, '請填寫題目').max(200),
  options: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
}).superRefine((q, ctx) => {
  if (q.type === 'choice' && (q.options?.length ?? 0) < 2) ctx.addIssue({ code: 'custom', message: `「${q.label}」需要至少兩個選項` });
});
const surveySchema = z.object({
  title: z.string().trim().min(1, '請填寫問卷名稱').max(60),
  questions: z.array(questionSchema).min(1, '請至少新增一題').max(20),
  active: z.boolean().optional(),
  afterClass: z.boolean().optional(),
});

export async function listSurveys(req: AuthRequest, res: Response) {
  const list = await prisma.survey.findMany({ where: { userId: req.userId! }, include: { _count: { select: { responses: true } } }, orderBy: { createdAt: 'desc' } });
  res.json(list);
}
export async function createSurvey(req: AuthRequest, res: Response) {
  res.status(201).json(await prisma.survey.create({ data: { ...surveySchema.parse(req.body), userId: req.userId! } }));
}
export async function updateSurvey(req: AuthRequest, res: Response) {
  const own = await prisma.survey.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到問卷');
  const d = surveySchema.partial().parse(req.body);
  if (d.questions && await prisma.surveyResponse.count({ where: { surveyId: own.id } })) throw badRequest('已有人填寫，不能修改題目（可停用後另建新問卷）');
  res.json(await prisma.survey.update({ where: { id: own.id }, data: d }));
}
export async function deleteSurvey(req: AuthRequest, res: Response) {
  const own = await prisma.survey.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到問卷');
  await prisma.survey.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

type Question = z.infer<typeof questionSchema>;

/** 問卷結果：評分題平均與分布、選擇題次數、文字題列表；可依教練或課程類型看評分 */
export async function surveyResults(req: AuthRequest, res: Response) {
  const s = await prisma.survey.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!s) throw notFound('找不到問卷');
  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId: s.id },
    include: { member: { select: { id: true, name: true } }, session: { select: { startsAt: true, classType: { select: { name: true } }, coach: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  const qs = s.questions as Question[];
  const questions = qs.map((q) => {
    const vals = responses.map((r) => (r.answers as Record<string, unknown>)[q.id]).filter((v) => v !== undefined && v !== null && v !== '');
    if (q.type === 'rating') {
      const nums = vals.map(Number).filter((n) => n >= 1 && n <= 5);
      const byCoach: Record<string, { sum: number; n: number }> = {};
      responses.forEach((r) => {
        const v = Number((r.answers as Record<string, unknown>)[q.id]);
        const c = r.session?.coach?.name;
        if (c && v >= 1 && v <= 5) { byCoach[c] ??= { sum: 0, n: 0 }; byCoach[c].sum += v; byCoach[c].n++; }
      });
      return {
        ...q, count: nums.length, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null,
        distribution: [1, 2, 3, 4, 5].map((k) => nums.filter((n) => n === k).length),
        byCoach: Object.entries(byCoach).map(([coach, v]) => ({ coach, average: Math.round((v.sum / v.n) * 10) / 10, count: v.n })),
      };
    }
    if (q.type === 'choice') return { ...q, count: vals.length, counts: (q.options ?? []).map((o) => ({ option: o, count: vals.filter((v) => v === o).length })) };
    return { ...q, count: vals.length, texts: responses.filter((r) => (r.answers as Record<string, unknown>)[q.id]).slice(0, 100).map((r) => ({ text: String((r.answers as Record<string, unknown>)[q.id]), member: r.member.name, at: r.createdAt })) };
  });
  res.json({ survey: s, total: responses.length, questions });
}

/** 會員端：可以填的問卷（一般問卷沒填過的；下課問卷以課程為單位） */
export async function portalSurveys(req: MemberRequest, res: Response) {
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.memberId! } });
  const surveys = await prisma.survey.findMany({ where: { userId: m.userId, active: true }, orderBy: { createdAt: 'desc' } });
  const done = await prisma.surveyResponse.findMany({ where: { memberId: m.id, surveyId: { in: surveys.map((s) => s.id) } }, select: { surveyId: true, sessionId: true } });
  const out: unknown[] = [];
  for (const s of surveys) {
    if (!s.afterClass) {
      if (!done.some((d) => d.surveyId === s.id && !d.sessionId)) out.push({ id: s.id, title: s.title, questions: s.questions, sessionId: null });
      continue;
    }
    // 下課問卷：近 7 天出席、還沒填的課（最多 3 堂）
    const recent = await prisma.booking.findMany({
      where: { memberId: m.id, status: 'ATTENDED', session: { endsAt: { lt: new Date(), gte: new Date(Date.now() - 7 * 86400e3) } } },
      include: { session: { include: { classType: true, coach: true } } }, orderBy: { session: { startsAt: 'desc' } }, take: 10,
    });
    recent.filter((b) => !done.some((d) => d.surveyId === s.id && d.sessionId === b.sessionId)).slice(0, 3).forEach((b) => out.push({
      id: s.id, title: s.title, questions: s.questions, sessionId: b.sessionId,
      session: { startsAt: b.session.startsAt, className: b.session.classType.name, coach: b.session.coach?.name ?? null },
    }));
  }
  res.json(out);
}

export async function portalAnswerSurvey(req: MemberRequest, res: Response) {
  const d = z.object({ sessionId: z.string().nullable().optional(), answers: z.record(z.union([z.string().max(1000), z.number()])) }).parse(req.body);
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.memberId! } });
  const s = await prisma.survey.findFirst({ where: { id: req.params.id, userId: m.userId, active: true } });
  if (!s) throw notFound('問卷已關閉');
  if (s.afterClass) {
    if (!d.sessionId) throw badRequest('缺少課程');
    if (!(await prisma.booking.count({ where: { memberId: m.id, sessionId: d.sessionId, status: 'ATTENDED' } }))) throw badRequest('只能評價自己出席的課程');
  }
  const qs = s.questions as Question[];
  const answers: Record<string, string | number> = {};
  for (const q of qs) {
    const v = d.answers[q.id];
    if (v === undefined || v === '') continue;
    if (q.type === 'rating') { const n = Number(v); if (!(n >= 1 && n <= 5)) throw badRequest(`「${q.label}」請選 1 ~ 5 分`); answers[q.id] = n; }
    else if (q.type === 'choice') { if (!q.options?.includes(String(v))) throw badRequest(`「${q.label}」選項不正確`); answers[q.id] = String(v); }
    else answers[q.id] = String(v).slice(0, 1000);
  }
  if (!Object.keys(answers).length) throw badRequest('請至少回答一題');
  const sessionId = s.afterClass ? d.sessionId! : null;
  // 一般問卷 sessionId 為 null，唯一鍵不擋 null，所以先檢查
  if (!sessionId && await prisma.surveyResponse.count({ where: { surveyId: s.id, memberId: m.id, sessionId: null } })) throw badRequest('已經填寫過了');
  try {
    res.status(201).json(await prisma.surveyResponse.create({ data: { userId: m.userId, surveyId: s.id, memberId: m.id, sessionId, answers } }));
  } catch {
    throw badRequest('已經填寫過了');
  }
}

/* ---------- 營運分析 ---------- */

/**
 * - 續約率：近 N 個月內到期（或用完）的方案中，會員在到期前或到期後 30 天內又購買的比例
 * - 每月流失：當月最後一張方案到期、30 天內沒有再購買的會員數
 * - 熱門時段：近 90 天出席人次，依星期 × 小時
 * - 課程排行、教練排行：近 90 天出席人次與平均滿班率
 */
export async function insights(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const studio = await getStudio(userId);
  const tz = studio.timezone;
  const today = localDate(new Date(), tz);
  const months: string[] = [];
  const [y, mo] = today.split('-').map(Number);
  for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(y, mo - 1 - i, 1)).toISOString().slice(0, 7));

  const memberships = await prisma.membership.findMany({
    where: { userId, status: { notIn: ['CANCELLED'] }, endDate: { gte: dateOnly(`${months[0]}-01`) } },
    select: { memberId: true, endDate: true, paidAt: true, status: true },
  });
  const allPurchases = await prisma.membership.findMany({ where: { userId, status: { not: 'CANCELLED' } }, select: { memberId: true, paidAt: true, endDate: true } });
  const byMember: Record<string, { paidAt: Date; endDate: Date }[]> = {};
  for (const p of allPurchases) (byMember[p.memberId] ??= []).push(p);

  const renewal = months.map((mon) => {
    const ended = memberships.filter((m) => dateOnlyStr(m.endDate).slice(0, 7) === mon && dateOnlyStr(m.endDate) < today && m.status !== 'TRANSFERRED');
    const members = [...new Set(ended.map((m) => m.memberId))];
    let renewed = 0, churned = 0;
    for (const id of members) {
      const lastEnd = ended.filter((e) => e.memberId === id).reduce((a, e) => (e.endDate > a ? e.endDate : a), new Date(0));
      const limit = new Date(lastEnd.getTime() + 30 * 86400e3);
      // 有任何一張方案在到期日之後還有效、或在到期前 30 天到到期後 30 天之間購買，就算續約
      const ok = (byMember[id] ?? []).some((p) => p.endDate > lastEnd && p.paidAt <= limit);
      if (ok) renewed++; else if (limit < new Date()) churned++;
    }
    return { month: mon, ended: members.length, renewed, churned, rate: members.length ? Math.round((renewed / members.length) * 100) : null };
  });

  const since = new Date(Date.now() - 90 * 86400e3);
  const sessions = await prisma.classSession.findMany({
    where: { userId, status: 'SCHEDULED', startsAt: { gte: since, lt: new Date() } },
    select: { startsAt: true, capacity: true, isPrivate: true, classType: { select: { id: true, name: true, color: true } }, coach: { select: { id: true, name: true } }, bookings: { where: { status: 'ATTENDED' }, select: { id: true } } },
  });
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const types: Record<string, { name: string; color: string; sessions: number; heads: number; fill: number }> = {};
  const coaches: Record<string, { name: string; sessions: number; heads: number; fill: number }> = {};
  for (const s of sessions) {
    const p = zonedParts(s.startsAt, tz);
    heat[p.weekday][p.hour] += s.bookings.length;
    const fill = s.capacity ? s.bookings.length / s.capacity : 0;
    const t = (types[s.classType.id] ??= { name: s.classType.name, color: s.classType.color, sessions: 0, heads: 0, fill: 0 });
    t.sessions++; t.heads += s.bookings.length; t.fill += fill;
    if (s.coach) { const c = (coaches[s.coach.id] ??= { name: s.coach.name, sessions: 0, heads: 0, fill: 0 }); c.sessions++; c.heads += s.bookings.length; c.fill += fill; }
  }
  const rank = <T extends { sessions: number; heads: number; fill: number }>(o: Record<string, T>) =>
    Object.values(o).map((v) => ({ ...v, fill: v.sessions ? Math.round((v.fill / v.sessions) * 100) : 0, avgHeads: v.sessions ? Math.round((v.heads / v.sessions) * 10) / 10 : 0 })).sort((a, b) => b.heads - a.heads);

  // 會員現況：有效方案會員、近 30 天有上課、久未上課（有方案但 30 天沒來，流失風險）
  const activePass = await prisma.member.findMany({
    where: { userId, status: 'ACTIVE', memberships: { some: { status: { in: ['ACTIVE', 'FROZEN'] }, endDate: { gte: dateOnly(today) } } } },
    select: { id: true, name: true, phone: true, bookings: { where: { status: 'ATTENDED' }, select: { session: { select: { startsAt: true } } }, orderBy: { session: { startsAt: 'desc' } }, take: 1 } },
  });
  const cutoff = new Date(Date.now() - 30 * 86400e3);
  const atRisk = activePass.filter((m) => !m.bookings[0] || m.bookings[0].session.startsAt < cutoff)
    .map((m) => ({ id: m.id, name: m.name, phone: m.phone, lastAttended: m.bookings[0]?.session.startsAt ?? null }));

  res.json({
    renewal, heat, classTypes: rank(types), coaches: rank(coaches),
    members: { activePass: activePass.length, recentlyActive: activePass.length - atRisk.length, atRisk: atRisk.length },
    atRisk: atRisk.slice(0, 50),
  });
}

/** 營收明細：方案、商品、置物櫃、場地租借，扣除退費。依月份（近 12 個月） */
export async function revenueBreakdown(userId: string) {
  const studio = await getStudio(userId);
  const tz = studio.timezone;
  const today = localDate(new Date(), tz);
  const months: string[] = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  const since = localToUtc(`${months[0]}-01`, '00:00', tz);
  const [products, lockers, rentals, refunds] = await Promise.all([
    prisma.productSale.findMany({ where: { userId, status: 'PAID', createdAt: { gte: since } }, select: { total: true, createdAt: true } }),
    prisma.lockerRental.findMany({ where: { userId, createdAt: { gte: since } }, select: { price: true, createdAt: true } }),
    prisma.roomBooking.findMany({ where: { userId, status: 'BOOKED', paid: true, startsAt: { gte: since } }, select: { price: true, startsAt: true } }),
    prisma.refund.findMany({ where: { userId, createdAt: { gte: since } }, select: { amount: true, createdAt: true } }),
  ]);
  const row = () => ({ products: 0, lockers: 0, rentals: 0, refunds: 0 });
  const by = Object.fromEntries(months.map((k) => [k, row()]));
  const add = (d: Date, k: keyof ReturnType<typeof row>, v: number) => { const mon = localDate(d, tz).slice(0, 7); if (by[mon]) by[mon][k] += v; };
  products.forEach((p) => add(p.createdAt, 'products', p.total));
  lockers.forEach((p) => add(p.createdAt, 'lockers', p.price));
  rentals.forEach((p) => add(p.startsAt, 'rentals', p.price));
  refunds.forEach((p) => add(p.createdAt, 'refunds', p.amount));
  return by;
}

