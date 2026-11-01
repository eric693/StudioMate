// 固定課表、課程（單堂）、預約與點名
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { badRequest, notFound } from '../utils/http';
import { dateOnly, localDate, localTime, localToUtc, addDays } from '../utils/time';
import { getStudio } from '../services/studioService';
import { generateSessions, resyncTemplate } from '../services/scheduleService';
import { bookSession, cancelBooking, cancelSession, setAttendance, updateCapacity } from '../services/bookingService';
import { notifyBookingChanges, notifySessionCancelled } from '../services/notifyService';

/** 刪除固定課表產生的課時留下的標記，列表一律不顯示 */
export const DELETED = '已刪除';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式須為 HH:MM');

async function ownClassType(userId: string, id: string) {
  const ct = await prisma.classType.findFirst({ where: { id, userId } });
  if (!ct) throw badRequest('找不到課程類型');
  return ct;
}
async function ownCoach(userId: string, id?: string | null) {
  if (!id) return;
  if (!(await prisma.coach.findFirst({ where: { id, userId } }))) throw badRequest('找不到教練');
}

/* ---------- 固定課表 ---------- */

const templateSchema = z.object({
  classTypeId: z.string(),
  coachId: z.string().nullable().optional(),
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: hhmm,
  durationMin: z.coerce.number().int().min(10).max(600).optional(),
  capacity: z.coerce.number().int().min(1).max(500).optional(),
  room: z.string().trim().max(40).nullable().optional(),
  activeFrom: day.optional(),
  activeTo: day.nullable().optional(),
});

export async function listTemplates(req: AuthRequest, res: Response) {
  res.json(await prisma.scheduleTemplate.findMany({
    where: { userId: req.userId! }, include: { classType: true, coach: true }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  }));
}

export async function createTemplate(req: AuthRequest, res: Response) {
  const d = templateSchema.parse(req.body);
  const ct = await ownClassType(req.userId!, d.classTypeId);
  await ownCoach(req.userId!, d.coachId);
  const studio = await getStudio(req.userId!);
  const t = await prisma.scheduleTemplate.create({
    data: {
      userId: req.userId!, classTypeId: ct.id, coachId: d.coachId ?? null, weekday: d.weekday, startTime: d.startTime,
      durationMin: d.durationMin ?? ct.durationMin, capacity: d.capacity ?? ct.defaultCapacity, room: d.room ?? null,
      activeFrom: dateOnly(d.activeFrom ?? localDate(new Date(), studio.timezone)), activeTo: d.activeTo ? dateOnly(d.activeTo) : null,
    },
  });
  const gen = await generateSessions(req.userId!);
  res.status(201).json({ template: t, created: gen.created });
}

export async function updateTemplate(req: AuthRequest, res: Response) {
  const own = await prisma.scheduleTemplate.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到固定課表');
  const d = templateSchema.partial().parse(req.body);
  if (d.classTypeId) await ownClassType(req.userId!, d.classTypeId);
  await ownCoach(req.userId!, d.coachId);
  const t = await prisma.scheduleTemplate.update({
    where: { id: own.id },
    data: {
      ...d,
      ...(d.activeFrom ? { activeFrom: dateOnly(d.activeFrom) } : {}),
      ...(d.activeTo !== undefined ? { activeTo: d.activeTo ? dateOnly(d.activeTo) : null } : {}),
    },
  });
  // 未來還沒有人預約的課程依新設定重建；已有預約的保留並回報數量
  res.json({ template: t, ...(await resyncTemplate(req.userId!, own.id)) });
}

export async function deleteTemplate(req: AuthRequest, res: Response) {
  const own = await prisma.scheduleTemplate.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到固定課表');
  const r = await resyncTemplate(req.userId!, own.id, false);
  await prisma.scheduleTemplate.delete({ where: { id: own.id } });
  res.json({ ok: true, removed: r.removed, kept: r.kept });
}

export async function runGenerate(req: AuthRequest, res: Response) {
  res.json(await generateSessions(req.userId!));
}

/* ---------- 課程 ---------- */

const seatedStatuses = ['BOOKED', 'ATTENDED'];

/** 課程列表（日期區間，教室當地日期），附正取、候補人數 */
export async function listSessions(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const from = day.parse(req.query.from ?? localDate(new Date(), studio.timezone));
  const to = day.parse(req.query.to ?? addDays(from, 6));
  const sessions = await prisma.classSession.findMany({
    where: {
      userId: req.userId!, startsAt: { gte: localToUtc(from, '00:00', studio.timezone), lt: localToUtc(addDays(to, 1), '00:00', studio.timezone) },
      NOT: { status: 'CANCELLED', cancelReason: DELETED },
    },
    include: { classType: true, coach: true, bookings: { select: { status: true } } },
    orderBy: { startsAt: 'asc' },
  });
  res.json(sessions.map(({ bookings, ...s }) => ({
    ...s,
    booked: bookings.filter((b) => seatedStatuses.includes(b.status)).length,
    waitlist: bookings.filter((b) => b.status === 'WAITLIST').length,
    attended: bookings.filter((b) => b.status === 'ATTENDED').length,
  })));
}

export async function getSession(req: AuthRequest, res: Response) {
  const s = await prisma.classSession.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      classType: true, coach: true,
      bookings: { include: { member: { select: { id: true, name: true, phone: true } }, membership: { select: { planName: true, kind: true, creditsLeft: true } } }, orderBy: { bookedAt: 'asc' } },
    },
  });
  if (!s) throw notFound('找不到這堂課');
  res.json(s);
}

const sessionSchema = z.object({
  classTypeId: z.string(),
  coachId: z.string().nullable().optional(),
  date: day,
  startTime: hhmm,
  durationMin: z.coerce.number().int().min(10).max(600).optional(),
  capacity: z.coerce.number().int().min(1).max(500).optional(),
  room: z.string().trim().max(40).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** 新增單堂課（不屬於固定課表，例如工作坊、加開課） */
export async function createSession(req: AuthRequest, res: Response) {
  const d = sessionSchema.parse(req.body);
  const ct = await ownClassType(req.userId!, d.classTypeId);
  await ownCoach(req.userId!, d.coachId);
  const studio = await getStudio(req.userId!);
  const startsAt = localToUtc(d.date, d.startTime, studio.timezone);
  const s = await prisma.classSession.create({
    data: {
      userId: req.userId!, classTypeId: ct.id, coachId: d.coachId ?? null, startsAt,
      endsAt: new Date(startsAt.getTime() + (d.durationMin ?? ct.durationMin) * 60e3),
      capacity: d.capacity ?? ct.defaultCapacity, room: d.room ?? null, note: d.note ?? null,
    },
  });
  res.status(201).json(s);
}

/**
 * 修改單堂課：課程類型、教練、教室、備註、名額（名額加大會自動遞補候補）。
 * 日期、時間、時長只有在還沒有人預約時才能改，避免會員預約的時段被悄悄換掉。
 */
export async function updateSession(req: AuthRequest, res: Response) {
  const own = await prisma.classSession.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到這堂課');
  if (own.status === 'CANCELLED') throw badRequest('這堂課已取消，無法修改');
  const d = z.object({
    classTypeId: z.string().optional(),
    coachId: z.string().nullable().optional(),
    date: day.optional(),
    startTime: hhmm.optional(),
    durationMin: z.coerce.number().int().min(10).max(600).optional(),
    room: z.string().trim().max(40).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    capacity: z.coerce.number().int().min(1).max(500).optional(),
  }).parse(req.body);
  await ownCoach(req.userId!, d.coachId);
  if (d.classTypeId) await ownClassType(req.userId!, d.classTypeId);
  const { capacity, date, startTime, durationMin, ...rest } = d;
  const data: Prisma.ClassSessionUncheckedUpdateInput = { ...rest };
  if (date || startTime || durationMin) {
    const studio = await getStudio(req.userId!);
    const startsAt = localToUtc(date ?? localDate(own.startsAt, studio.timezone), startTime ?? localTime(own.startsAt, studio.timezone), studio.timezone);
    const minutes = durationMin ?? Math.round((own.endsAt.getTime() - own.startsAt.getTime()) / 60e3);
    const changed = startsAt.getTime() !== own.startsAt.getTime() || minutes * 60e3 !== own.endsAt.getTime() - own.startsAt.getTime();
    if (changed) {
      if (await prisma.booking.count({ where: { sessionId: own.id, status: { in: ['BOOKED', 'WAITLIST', 'ATTENDED', 'NO_SHOW'] } } })) {
        throw badRequest('這堂課已經有人預約，無法改時間；請取消整堂課（會退堂並通知）後重新加開');
      }
      // 從固定課表產生的課改了時間，就脫離固定課表，避免排程再補回原時段時撞到唯一鍵
      Object.assign(data, { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60e3), templateId: null });
    }
  }
  if (Object.keys(data).length) await prisma.classSession.update({ where: { id: own.id }, data });
  if (capacity !== undefined && capacity !== own.capacity) {
    const r = await updateCapacity(req.userId!, own.id, capacity);
    await notifyBookingChanges(req.userId!, r.promoted);
  }
  res.json(await prisma.classSession.findUnique({ where: { id: own.id } }));
}

/**
 * 刪除單堂課：只限沒有任何預約紀錄的課（有紀錄請用「取消整堂課」保留退堂軌跡）。
 * 固定課表產生的課改為「已刪除」的取消狀態保留一筆，否則每日排程會依固定課表再產生回來。
 */
export async function deleteSession(req: AuthRequest, res: Response) {
  const own = await prisma.classSession.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到這堂課');
  if (await prisma.booking.count({ where: { sessionId: own.id } })) throw badRequest('這堂課有預約紀錄，請改用「取消整堂課」');
  if (own.templateId) await prisma.classSession.update({ where: { id: own.id }, data: { status: 'CANCELLED', cancelReason: DELETED } });
  else await prisma.classSession.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

export async function cancelSessionHandler(req: AuthRequest, res: Response) {
  const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body ?? {});
  const affected = await cancelSession(req.userId!, req.params.id, reason ?? '');
  await notifySessionCancelled(req.userId!, req.params.id, affected, reason);
  res.json({ ok: true, affected: affected.length });
}

/* ---------- 預約與點名 ---------- */

export async function createBooking(req: AuthRequest, res: Response) {
  const { sessionId, memberId } = z.object({ sessionId: z.string(), memberId: z.string() }).parse(req.body);
  res.status(201).json(await bookSession({ userId: req.userId!, sessionId, memberId, source: 'STAFF' }));
}

export async function cancelBookingHandler(req: AuthRequest, res: Response) {
  const { forceRefund } = z.object({ forceRefund: z.boolean().optional() }).parse(req.body ?? {});
  const r = await cancelBooking({ userId: req.userId!, bookingId: req.params.id, by: 'STAFF', forceRefund });
  await notifyBookingChanges(req.userId!, r.promoted ? [r.promoted] : []);
  res.json(r);
}

export async function attendance(req: AuthRequest, res: Response) {
  const { action } = z.object({ action: z.enum(['attend', 'noshow', 'undo']) }).parse(req.body);
  res.json(await setAttendance(req.userId!, req.params.id, action));
}
