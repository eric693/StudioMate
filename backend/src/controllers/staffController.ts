// 教練請假與代課、員工班表、打卡
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, formatLocal, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { notifyMember } from '../services/lineService';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式須為 HH:MM');

/* ---------- 代課 ---------- */

/** 換教練並通知已預約的會員。第一次代課時記住原本的教練，之後換回原教練就清除代課標記 */
export async function applySubstitute(userId: string, sessionId: string, substituteId: string, note?: string | null, notify = true) {
  const studio = await getStudio(userId);
  const s = await prisma.classSession.findFirst({ where: { id: sessionId, userId }, include: { classType: true, coach: true } });
  if (!s) throw notFound('找不到課程');
  if (s.status !== 'SCHEDULED') throw badRequest('課程已取消');
  if (s.endsAt < new Date()) throw badRequest('課程已結束');
  const sub = await prisma.coach.findFirst({ where: { id: substituteId, userId, active: true } });
  if (!sub) throw notFound('找不到代課教練');
  if (sub.id === s.coachId) throw badRequest('代課教練與目前的教練相同');
  const original = s.originalCoachId ?? s.coachId;
  const backToOriginal = original === sub.id;
  const updated = await prisma.classSession.update({
    where: { id: s.id },
    data: { coachId: sub.id, originalCoachId: backToOriginal ? null : original, substituteNote: backToOriginal ? null : (note ?? null) },
  });
  let notified = 0;
  if (notify) {
    const bookings = await prisma.booking.findMany({ where: { sessionId: s.id, status: { in: ['BOOKED', 'WAITLIST'] } } });
    for (const b of bookings) {
      const r = await notifyMember(userId, b.memberId, 'SUBSTITUTE', `${s.id}:${sub.id}`,
        `【${studio.name}】教練異動通知\n${formatLocal(s.startsAt, studio.timezone)} 的 ${s.classType.name} 改由 ${sub.name} 教練授課${s.coach ? `（原 ${s.coach.name}）` : ''}。如需取消請於開課前 ${studio.cancelDeadlineHours} 小時辦理。`);
      if (r === 'sent' || r === 'sandbox') notified++;
    }
  }
  return { session: updated, notified };
}

export async function substituteHandler(req: AuthRequest, res: Response) {
  const d = z.object({ coachId: z.string(), note: z.string().max(200).nullable().optional(), notify: z.boolean().optional() }).parse(req.body);
  res.json(await applySubstitute(req.userId!, req.params.id, d.coachId, d.note, d.notify ?? true));
}

/* ---------- 請假申請 ---------- */

/** 請假申請列表（教練帳號只看到自己的） */
export async function listLeaves(req: AuthRequest, res: Response) {
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status || undefined);
  const me = await prisma.user.findUnique({ where: { id: req.authUserId! }, select: { coachId: true, role: true } });
  res.json(await prisma.leaveRequest.findMany({
    where: { userId: req.userId!, ...(status ? { status } : {}), ...(me?.role === 'STAFF' && me.coachId ? { coachId: me.coachId } : {}) },
    include: {
      coach: { select: { id: true, name: true } }, substitute: { select: { id: true, name: true } },
      session: { select: { id: true, startsAt: true, endsAt: true, room: true, classType: { select: { name: true, color: true } }, _count: { select: { bookings: { where: { status: 'BOOKED' } } } } } },
    },
    orderBy: [{ status: 'asc' }, { session: { startsAt: 'asc' } }],
    take: 300,
  }));
}

/** 提出請假：管理員可替任何教練申請；教練帳號只能替自己申請 */
export async function createLeave(req: AuthRequest, res: Response) {
  const d = z.object({ sessionId: z.string(), reason: z.string().trim().max(200).optional(), substituteId: z.string().nullable().optional() }).parse(req.body);
  const s = await prisma.classSession.findFirst({ where: { id: d.sessionId, userId: req.userId! } });
  if (!s) throw notFound('找不到課程');
  if (!s.coachId) throw badRequest('這堂課沒有指定教練');
  if (s.startsAt < new Date()) throw badRequest('課程已開始，無法請假');
  const me = await prisma.user.findUnique({ where: { id: req.authUserId! }, select: { coachId: true, role: true } });
  if (me?.role === 'STAFF' && me.coachId && me.coachId !== s.coachId) throw badRequest('只能替自己的課請假');
  if (await prisma.leaveRequest.count({ where: { sessionId: s.id, status: 'PENDING' } })) throw badRequest('這堂課已有待審核的請假申請');
  res.status(201).json(await prisma.leaveRequest.create({
    data: { userId: req.userId!, sessionId: s.id, coachId: s.coachId, reason: d.reason, substituteId: d.substituteId ?? null, createdById: req.authUserId },
  }));
}

/** 審核：核准時一定要指定代課教練（套用代課並通知會員），或改成取消課程由課表處理 */
export async function reviewLeave(req: AuthRequest, res: Response) {
  const d = z.object({ action: z.enum(['approve', 'reject']), substituteId: z.string().optional(), note: z.string().max(200).optional() }).parse(req.body);
  if (req.role !== 'ADMIN') {
    const me = await prisma.user.findUnique({ where: { id: req.authUserId! }, select: { coachId: true } });
    if (me?.coachId) throw badRequest('教練帳號不能審核請假');
  }
  const lr = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!lr) throw notFound('找不到請假申請');
  if (lr.status !== 'PENDING') throw badRequest('這筆申請已審核過');
  if (d.action === 'approve') {
    const subId = d.substituteId ?? lr.substituteId;
    if (!subId) throw badRequest('請選擇代課教練');
    await applySubstitute(req.userId!, lr.sessionId, subId, lr.reason ? `請假：${lr.reason}` : '請假代課');
    res.json(await prisma.leaveRequest.update({ where: { id: lr.id }, data: { status: 'APPROVED', substituteId: subId, reviewNote: d.note, reviewedAt: new Date() } }));
    return;
  }
  res.json(await prisma.leaveRequest.update({ where: { id: lr.id }, data: { status: 'REJECTED', reviewNote: d.note, reviewedAt: new Date() } }));
}

export async function deleteLeave(req: AuthRequest, res: Response) {
  const lr = await prisma.leaveRequest.findFirst({ where: { id: req.params.id, userId: req.userId!, status: 'PENDING' } });
  if (!lr) throw notFound('找不到待審核的申請');
  await prisma.leaveRequest.delete({ where: { id: lr.id } });
  res.json({ ok: true });
}

/* ---------- 員工班表 ---------- */

const shiftSchema = z.object({ staffId: z.string(), date: day, startTime: hhmm, endTime: hhmm, note: z.string().max(200).nullable().optional() });

async function ownStaff(userId: string, staffId: string) {
  const u = await prisma.user.findFirst({ where: { id: staffId, OR: [{ id: userId }, { ownerId: userId }] } });
  if (!u) throw badRequest('找不到員工');
  return u;
}

export async function listShifts(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const from = day.catch(localDate(new Date(), studio.timezone)).parse(req.query.from);
  const to = day.catch(addDays(from, 6)).parse(req.query.to);
  const [shifts, staff] = await Promise.all([
    prisma.staffShift.findMany({ where: { userId: req.userId!, date: { gte: dateOnly(from), lte: dateOnly(to) } }, include: { staff: { select: { id: true, name: true } } }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }] }),
    prisma.user.findMany({ where: { OR: [{ id: req.userId! }, { ownerId: req.userId! }], active: true }, select: { id: true, name: true, role: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  res.json({ from, to, shifts, staff });
}

export async function createShift(req: AuthRequest, res: Response) {
  const d = shiftSchema.parse(req.body);
  if (d.endTime <= d.startTime) throw badRequest('下班時間須晚於上班時間');
  await ownStaff(req.userId!, d.staffId);
  res.status(201).json(await prisma.staffShift.create({ data: { ...d, date: dateOnly(d.date), userId: req.userId! } }));
}

export async function updateShift(req: AuthRequest, res: Response) {
  const own = await prisma.staffShift.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到班表');
  const d = shiftSchema.partial().parse(req.body);
  if (d.staffId) await ownStaff(req.userId!, d.staffId);
  const start = d.startTime ?? own.startTime, end = d.endTime ?? own.endTime;
  if (end <= start) throw badRequest('下班時間須晚於上班時間');
  res.json(await prisma.staffShift.update({ where: { id: own.id }, data: { ...d, ...(d.date ? { date: dateOnly(d.date) } : {}) } }));
}

export async function deleteShift(req: AuthRequest, res: Response) {
  const own = await prisma.staffShift.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到班表');
  await prisma.staffShift.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 複製上週班表到本週（同一天、同時段；已存在相同班次就略過） */
export async function copyWeekShifts(req: AuthRequest, res: Response) {
  const { from } = z.object({ from: day }).parse(req.body);
  const prev = await prisma.staffShift.findMany({ where: { userId: req.userId!, date: { gte: dateOnly(addDays(from, -7)), lte: dateOnly(addDays(from, -1)) } } });
  let created = 0;
  for (const s of prev) {
    const date = dateOnly(addDays(s.date.toISOString().slice(0, 10), 7));
    const exists = await prisma.staffShift.count({ where: { userId: req.userId!, staffId: s.staffId, date, startTime: s.startTime } });
    if (exists) continue;
    await prisma.staffShift.create({ data: { userId: req.userId!, staffId: s.staffId, date, startTime: s.startTime, endTime: s.endTime, note: s.note } });
    created++;
  }
  res.json({ created });
}

/* ---------- 打卡 ---------- */

/** 自己的打卡狀態：今天的班表與目前是否上班中 */
export async function myClock(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const today = localDate(new Date(), studio.timezone);
  const [open, shifts, recent] = await Promise.all([
    prisma.timeClock.findFirst({ where: { staffId: req.authUserId!, clockOut: null }, orderBy: { clockIn: 'desc' } }),
    prisma.staffShift.findMany({ where: { userId: req.userId!, staffId: req.authUserId!, date: dateOnly(today) }, orderBy: { startTime: 'asc' } }),
    prisma.timeClock.findMany({ where: { staffId: req.authUserId! }, orderBy: { clockIn: 'desc' }, take: 10 }),
  ]);
  res.json({ open, shifts, recent });
}

export async function clockIn(req: AuthRequest, res: Response) {
  if (await prisma.timeClock.count({ where: { staffId: req.authUserId!, clockOut: null } })) throw badRequest('已經在上班中，請先打下班卡');
  res.status(201).json(await prisma.timeClock.create({ data: { userId: req.userId!, staffId: req.authUserId!, clockIn: new Date() } }));
}

export async function clockOut(req: AuthRequest, res: Response) {
  const open = await prisma.timeClock.findFirst({ where: { staffId: req.authUserId!, clockOut: null }, orderBy: { clockIn: 'desc' } });
  if (!open) throw badRequest('還沒打上班卡');
  res.json(await prisma.timeClock.update({ where: { id: open.id }, data: { clockOut: new Date() } }));
}

/** 管理員補登或修正打卡 */
export async function upsertClock(req: AuthRequest, res: Response) {
  const d = z.object({ staffId: z.string(), date: day, inTime: hhmm, outTime: hhmm.nullable().optional(), note: z.string().max(200).nullable().optional() }).parse(req.body);
  await ownStaff(req.userId!, d.staffId);
  const studio = await getStudio(req.userId!);
  const inAt = localToUtc(d.date, d.inTime, studio.timezone);
  const outAt = d.outTime ? localToUtc(d.outTime < d.inTime ? addDays(d.date, 1) : d.date, d.outTime, studio.timezone) : null;
  const data = { userId: req.userId!, staffId: d.staffId, clockIn: inAt, clockOut: outAt, note: d.note ?? null };
  if (req.params.id) {
    const own = await prisma.timeClock.findFirst({ where: { id: req.params.id, userId: req.userId! } });
    if (!own) throw notFound('找不到打卡紀錄');
    res.json(await prisma.timeClock.update({ where: { id: own.id }, data }));
    return;
  }
  res.status(201).json(await prisma.timeClock.create({ data }));
}

export async function deleteClock(req: AuthRequest, res: Response) {
  const own = await prisma.timeClock.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到打卡紀錄');
  await prisma.timeClock.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 出勤報表：某月每位員工的打卡紀錄、工時、與排班的比較 */
export async function clockReport(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const month = z.string().regex(/^\d{4}-\d{2}$/).catch(localDate(new Date(), studio.timezone).slice(0, 7)).parse(req.query.month);
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const from = localToUtc(`${month}-01`, '00:00', studio.timezone), to = localToUtc(next, '00:00', studio.timezone);
  const [clocks, shifts, staff] = await Promise.all([
    prisma.timeClock.findMany({ where: { userId: req.userId!, clockIn: { gte: from, lt: to } }, orderBy: { clockIn: 'asc' } }),
    prisma.staffShift.findMany({ where: { userId: req.userId!, date: { gte: dateOnly(`${month}-01`), lt: dateOnly(next) } } }),
    prisma.user.findMany({ where: { OR: [{ id: req.userId! }, { ownerId: req.userId! }] }, select: { id: true, name: true, active: true } }),
  ]);
  const mins = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - h1 * 60 - m1; };
  const rows = staff.map((u) => {
    const mine = clocks.filter((c) => c.staffId === u.id);
    const worked = mine.reduce((a, c) => a + (c.clockOut ? (c.clockOut.getTime() - c.clockIn.getTime()) / 60e3 : 0), 0);
    const scheduled = shifts.filter((s) => s.staffId === u.id).reduce((a, s) => a + mins(s.startTime, s.endTime), 0);
    return { staffId: u.id, name: u.name, active: u.active, days: new Set(mine.map((c) => localDate(c.clockIn, studio.timezone))).size, workedHours: Math.round(worked / 6) / 10, scheduledHours: Math.round(scheduled / 6) / 10, open: mine.filter((c) => !c.clockOut).length, clocks: mine };
  }).filter((r) => r.clocks.length || r.scheduledHours || r.active);
  res.json({ month, rows });
}
