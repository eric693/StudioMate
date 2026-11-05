// 營運功能：自助簽到、教練時段與私人課、教練薪資、直播連結、行事曆訂閱、分店、場地租借
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { MemberRequest } from '../middleware/memberAuth';
import { badRequest, conflict, notFound } from '../utils/http';
import { addDays, formatLocal, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { bookPrivate, privateOptions, privateSlots } from '../services/privateService';
import { assertTermsAccepted } from './commerceController';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時間格式須為 HH:MM');
const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== undefined));

/* ---------- 自助簽到 ---------- */

/** 後台：櫃檯 QR code 的內容（會員端簽到網址） */
export async function checkInInfo(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  res.json({ enabled: studio.selfCheckIn, token: studio.checkInToken, name: studio.name, beforeMin: studio.checkInBeforeMin });
}

/** 後台：重新產生簽到 QR code（舊的立即失效，例如 QR code 照片外流時） */
export async function rotateCheckIn(req: AuthRequest, res: Response) {
  await getStudio(req.userId!);
  const token = (await prisma.$queryRaw<{ t: string }[]>`SELECT replace(gen_random_uuid()::text, '-', '') AS t`)[0].t;
  await prisma.studio.update({ where: { userId: req.userId! }, data: { checkInToken: token } });
  res.json({ token });
}

/** 會員掃 QR code 簽到：找出今天開課前 N 分鐘到下課之間、自己已預約的課，標記出席 */
export async function memberCheckIn(req: MemberRequest, res: Response) {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  const m = await prisma.member.findUnique({ where: { id: req.memberId! } });
  if (!m) throw notFound('找不到會員');
  const studio = await getStudio(m.userId);
  if (studio.checkInToken !== token) throw badRequest('QR code 無效，請掃描教室櫃檯最新的 QR code');
  if (!studio.selfCheckIn) throw badRequest('教室目前未開放自助簽到');
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: {
      memberId: m.id, status: { in: ['BOOKED', 'ATTENDED'] },
      session: { status: 'SCHEDULED', startsAt: { lte: new Date(now.getTime() + studio.checkInBeforeMin * 60e3) }, endsAt: { gte: now } },
    },
    include: { session: { include: { classType: true } } },
    orderBy: { session: { startsAt: 'asc' } },
  });
  if (!bookings.length) throw badRequest(`現在沒有可以簽到的課程（開課前 ${studio.checkInBeforeMin} 分鐘開放簽到）`);
  const b = bookings[0];
  if (b.status === 'BOOKED') await prisma.booking.update({ where: { id: b.id }, data: { status: 'ATTENDED', checkedInAt: now } });
  res.json({ already: b.status === 'ATTENDED', className: b.session.classType.name, time: formatLocal(b.session.startsAt, studio.timezone) });
}

/* ---------- 教練可預約時段 ---------- */

export async function getAvailability(req: AuthRequest, res: Response) {
  const coach = await prisma.coach.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!coach) throw notFound('找不到教練');
  res.json(await prisma.coachAvailability.findMany({ where: { coachId: coach.id }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] }));
}

/** 整批取代教練的每週時段 */
export async function setAvailability(req: AuthRequest, res: Response) {
  const coach = await prisma.coach.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!coach) throw notFound('找不到教練');
  const slots = z.array(z.object({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm }))
    .max(70).parse(req.body?.slots ?? []);
  for (const s of slots) if (s.startTime >= s.endTime) throw badRequest('結束時間須晚於開始時間');
  await prisma.$transaction([
    prisma.coachAvailability.deleteMany({ where: { coachId: coach.id } }),
    prisma.coachAvailability.createMany({ data: slots.map((s) => ({ ...s, userId: req.userId!, coachId: coach.id })) }),
  ]);
  res.json(await prisma.coachAvailability.findMany({ where: { coachId: coach.id }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] }));
}

/* ---------- 私人課 ---------- */

const slotQuery = z.object({ coachId: z.string(), classTypeId: z.string(), date: day });

export async function staffPrivateSlots(req: AuthRequest, res: Response) {
  const q = slotQuery.parse(req.query);
  res.json(await privateSlots(req.userId!, q.coachId, q.classTypeId, q.date));
}
export async function staffPrivateBook(req: AuthRequest, res: Response) {
  const d = slotQuery.extend({ memberId: z.string(), startTime: hhmm }).parse(req.body);
  res.status(201).json(await bookPrivate(req.userId!, { ...d, source: 'STAFF' }));
}
export async function staffPrivateOptions(req: AuthRequest, res: Response) {
  res.json(await privateOptions(req.userId!));
}

async function memberOf(req: MemberRequest) {
  const m = await prisma.member.findUnique({ where: { id: req.memberId! } });
  if (!m || m.status !== 'ACTIVE') throw notFound('會員帳號不存在或已停用');
  return m;
}
export async function portalPrivateOptions(req: MemberRequest, res: Response) {
  res.json(await privateOptions((await memberOf(req)).userId));
}
export async function portalPrivateSlots(req: MemberRequest, res: Response) {
  const m = await memberOf(req);
  const q = slotQuery.parse(req.query);
  res.json(await privateSlots(m.userId, q.coachId, q.classTypeId, q.date));
}
export async function portalPrivateBook(req: MemberRequest, res: Response) {
  const m = await memberOf(req);
  await assertTermsAccepted(m.id);
  const d = slotQuery.extend({ startTime: hhmm }).parse(req.body);
  res.status(201).json(await bookPrivate(m.userId, { ...d, memberId: m.id, source: 'MEMBER' }));
}

/* ---------- 直播連結 ---------- */

/** 只有已預約（或已出席）的會員，在開課前 15 分鐘到下課之間拿得到直播連結 */
export async function portalLiveLink(req: MemberRequest, res: Response) {
  const b = await prisma.booking.findFirst({ where: { id: req.params.id, memberId: req.memberId! }, include: { session: true } });
  if (!b) throw notFound('找不到預約');
  if (!['BOOKED', 'ATTENDED'].includes(b.status)) throw badRequest('這筆預約無法進入直播');
  if (!b.session.liveUrl) throw badRequest('這堂課沒有直播連結');
  const now = Date.now();
  if (now < b.session.startsAt.getTime() - 15 * 60e3) throw badRequest('開課前 15 分鐘開放進入直播');
  if (now > b.session.endsAt.getTime()) throw badRequest('直播已結束');
  if (b.status === 'BOOKED') await prisma.booking.update({ where: { id: b.id }, data: { status: 'ATTENDED', checkedInAt: new Date() } });
  res.json({ url: b.session.liveUrl });
}

/* ---------- 行事曆訂閱（iCalendar） ---------- */

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export async function calendarFeed(req: Request, res: Response) {
  const token = String(req.params.token).replace(/\.ics$/, '');
  const m = await prisma.member.findUnique({ where: { calendarToken: token } });
  if (!m) { res.status(404).end(); return; }
  const studio = await getStudio(m.userId);
  const bookings = await prisma.booking.findMany({
    where: { memberId: m.id, status: { in: ['BOOKED', 'WAITLIST', 'ATTENDED'] }, session: { startsAt: { gte: new Date(Date.now() - 30 * 86400e3) }, status: 'SCHEDULED' } },
    include: { session: { include: { classType: true, coach: true, branch: true } } },
  });
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StudioMate//TW', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(studio.name)} 課程`, 'X-WR-TIMEZONE:Asia/Taipei'];
  for (const b of bookings) {
    const s = b.session;
    lines.push('BEGIN:VEVENT', `UID:${b.id}@studiomate`, `DTSTAMP:${icsTime(new Date())}`, `DTSTART:${icsTime(s.startsAt)}`, `DTEND:${icsTime(s.endsAt)}`,
      `SUMMARY:${icsEscape(`${b.status === 'WAITLIST' ? '（候補）' : ''}${s.classType.name}`)}`,
      `LOCATION:${icsEscape([studio.name, s.branch?.name, s.room].filter(Boolean).join(' '))}`,
      `DESCRIPTION:${icsEscape(`教練：${s.coach?.name ?? '待定'}${s.note ? `\n${s.note}` : ''}`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.join('\r\n'));
}

/* ---------- 教練薪資報表 ---------- */

/**
 * 某月份（教室當地）已結束、未取消的課：堂數、出席人數、課程產值與薪資。
 * 課程產值＝出席者所用方案的每堂單價（售價 ÷ 總堂數 × 扣堂數；期限卡以售價 ÷ 該方案實際上課次數）。
 * 薪資＝每堂鐘點 × 堂數 ＋ 每堂超過門檻人數 × 每人加給 ＋ 課程產值 × 抽成％。
 */
export async function coachPayReport(userId: string, month: string) {
  const studio = await getStudio(userId);
  const from = localToUtc(`${month}-01`, '00:00', studio.timezone);
  const [y, mo] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const to = localToUtc(next, '00:00', studio.timezone);
  const sessions = await prisma.classSession.findMany({
    where: { userId, status: 'SCHEDULED', coachId: { not: null }, startsAt: { gte: from, lt: to }, endsAt: { lte: new Date() } },
    include: { classType: true, bookings: { where: { status: 'ATTENDED' }, include: { membership: true } } },
    orderBy: { startsAt: 'asc' },
  });
  const periodIds = [...new Set(sessions.flatMap((s) => s.bookings.filter((b) => b.membership?.kind === 'PERIOD').map((b) => b.membershipId!)))];
  const periodUse = Object.fromEntries((await prisma.booking.groupBy({ by: ['membershipId'], where: { membershipId: { in: periodIds }, status: 'ATTENDED' }, _count: true }))
    .map((g) => [g.membershipId!, g._count]));
  const unit = (b: (typeof sessions)[number]['bookings'][number]) => {
    const ms = b.membership;
    if (!ms) return 0;
    const base = ms.valueBase ?? ms.price; // 轉讓來的方案以轉讓時的剩餘價值計算
    if (ms.kind === 'PERIOD') return base / Math.max(1, periodUse[ms.id] ?? 1);
    return (base / Math.max(1, ms.creditsTotal ?? 1)) * Math.max(1, b.creditsCharged);
  };
  const coaches = await prisma.coach.findMany({ where: { userId } });
  const rows = coaches.map((c) => {
    const mine = sessions.filter((s) => s.coachId === c.id);
    const values = mine.map((s) => Math.round(s.bookings.reduce((a, b) => a + unit(b), 0)));
    // 階梯式抽成：當月總產值達到的最高門檻 % 套用到整月；沒設定就用固定 %
    const tiers = Array.isArray(c.shareTiers) ? (c.shareTiers as { min: number; rate: number }[]) : [];
    const monthValue = values.reduce((a, v) => a + v, 0);
    const reached = [...tiers].sort((a, b) => a.min - b.min).filter((t) => monthValue >= t.min);
    const rate = tiers.length ? (reached.at(-1)?.rate ?? 0) : c.revenueShare;
    const detail = mine.map((s, i) => {
      const heads = s.bookings.length;
      const value = values[i];
      const pay = c.payPerClass + Math.max(0, heads - c.headThreshold) * c.payPerHead + Math.round(value * rate / 100);
      return { sessionId: s.id, startsAt: s.startsAt, className: s.classType.name, heads, capacity: s.capacity, value, pay, substitute: Boolean(s.originalCoachId) };
    });
    return {
      coachId: c.id, coachName: c.name, active: c.active,
      rule: { payPerClass: c.payPerClass, payPerHead: c.payPerHead, headThreshold: c.headThreshold, revenueShare: c.revenueShare, tiers, appliedRate: rate },
      classes: detail.length, heads: detail.reduce((a, d) => a + d.heads, 0),
      fillRate: detail.length ? Math.round(detail.reduce((a, d) => a + d.heads / d.capacity, 0) / detail.length * 100) : null,
      value: detail.reduce((a, d) => a + d.value, 0), pay: detail.reduce((a, d) => a + d.pay, 0), detail,
    };
  }).filter((r) => r.classes > 0 || r.active);
  return { month, rows, totals: { classes: rows.reduce((a, r) => a + r.classes, 0), value: rows.reduce((a, r) => a + r.value, 0), pay: rows.reduce((a, r) => a + r.pay, 0) } };
}

export async function coachPay(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const month = z.string().regex(/^\d{4}-\d{2}$/).catch(localDate(new Date(), studio.timezone).slice(0, 7)).parse(req.query.month);
  res.json(await coachPayReport(req.userId!, month));
}

/* ---------- 分店 ---------- */

const branchSchema = z.object({
  name: z.string().trim().min(1, '請填寫分店名稱').max(40),
  address: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  active: z.boolean().optional(),
});
export async function listBranches(req: AuthRequest, res: Response) {
  res.json(await prisma.branch.findMany({ where: { userId: req.userId! }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
}
export async function createBranch(req: AuthRequest, res: Response) {
  res.status(201).json(await prisma.branch.create({ data: { ...branchSchema.parse(req.body), userId: req.userId! } }));
}
export async function updateBranch(req: AuthRequest, res: Response) {
  const own = await prisma.branch.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到分店');
  res.json(await prisma.branch.update({ where: { id: own.id }, data: branchSchema.partial().parse(req.body) }));
}
export async function deleteBranch(req: AuthRequest, res: Response) {
  const own = await prisma.branch.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到分店');
  const used = await prisma.scheduleTemplate.count({ where: { branchId: own.id } })
    + await prisma.classSession.count({ where: { branchId: own.id, startsAt: { gt: new Date() } } })
    + await prisma.room.count({ where: { branchId: own.id } });
  if (used) throw badRequest('這間分店還有固定課表、未來課程或場地，請先移除或改為停用');
  await prisma.branch.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/* ---------- 場地 ---------- */

const roomSchema = z.object({
  name: z.string().trim().min(1, '請填寫場地名稱').max(40),
  branchId: z.string().nullable().optional(),
  hourlyRate: z.coerce.number().int().min(0).max(100000).optional(),
  capacity: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  active: z.boolean().optional(),
  note: z.string().max(200).nullable().optional(),
});
async function ownBranch(userId: string, id?: string | null) {
  if (id && !(await prisma.branch.findFirst({ where: { id, userId } }))) throw badRequest('找不到分店');
}
export async function listRooms(req: AuthRequest, res: Response) {
  res.json(await prisma.room.findMany({ where: { userId: req.userId! }, include: { branch: { select: { id: true, name: true } } }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
}
export async function createRoom(req: AuthRequest, res: Response) {
  const d = roomSchema.parse(req.body);
  await ownBranch(req.userId!, d.branchId);
  res.status(201).json(await prisma.room.create({ data: { ...d, userId: req.userId! } }));
}
export async function updateRoom(req: AuthRequest, res: Response) {
  const own = await prisma.room.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到場地');
  const d = roomSchema.partial().parse(req.body);
  await ownBranch(req.userId!, d.branchId);
  res.json(await prisma.room.update({ where: { id: own.id }, data: d }));
}
export async function deleteRoom(req: AuthRequest, res: Response) {
  const own = await prisma.room.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到場地');
  if (await prisma.roomBooking.count({ where: { roomId: own.id } })) throw badRequest('這個場地有租借紀錄，請改為停用');
  await prisma.room.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/* ---------- 場地租借 ---------- */

const rentalSchema = z.object({
  roomId: z.string(),
  memberId: z.string().nullable().optional(),
  renterName: z.string().trim().min(1, '請填寫租借人').max(40),
  renterPhone: z.string().trim().max(30).nullable().optional(),
  date: day,
  startTime: hhmm,
  endTime: hhmm,
  price: z.coerce.number().int().min(0).max(1_000_000).optional(),
  paid: z.boolean().optional(),
  payMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

/** 時段衝突：同場地其他租借，或同名教室已排的課程 */
async function rentalConflict(userId: string, roomId: string, startsAt: Date, endsAt: Date, exceptId?: string) {
  const room = await prisma.room.findFirstOrThrow({ where: { id: roomId, userId } });
  const other = await prisma.roomBooking.findFirst({
    where: { roomId, status: 'BOOKED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (other) return `與 ${other.renterName} 的租借時段重疊`;
  const cls = await prisma.classSession.findFirst({
    where: { userId, room: room.name, status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    include: { classType: true },
  });
  return cls ? `這個時段「${room.name}」已排了 ${cls.classType.name}` : null;
}

export async function listRentals(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const f = z.object({
    from: day.optional(), to: day.optional(), q: z.string().trim().optional(), roomId: z.string().optional(),
    status: z.enum(['BOOKED', 'CANCELLED']).optional(), paid: z.enum(['yes', 'no']).optional(),
  }).parse(clean(req.query));
  const from = f.from ?? localDate(new Date(), studio.timezone);
  const to = f.to ?? addDays(from, 30);
  res.json(await prisma.roomBooking.findMany({
    where: {
      userId: req.userId!,
      startsAt: { gte: localToUtc(from, '00:00', studio.timezone), lt: localToUtc(addDays(to, 1), '00:00', studio.timezone) },
      ...(f.roomId ? { roomId: f.roomId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.paid ? { paid: f.paid === 'yes' } : {}),
      ...(f.q ? { OR: [{ renterName: { contains: f.q, mode: 'insensitive' as const } }, { renterPhone: { contains: f.q } }, { note: { contains: f.q, mode: 'insensitive' as const } }] } : {}),
    },
    include: { room: { select: { id: true, name: true, hourlyRate: true } } },
    orderBy: { startsAt: 'asc' },
    take: 500,
  }));
}

async function rentalData(userId: string, d: z.infer<typeof rentalSchema>, exceptId?: string) {
  const studio = await getStudio(userId);
  const room = await prisma.room.findFirst({ where: { id: d.roomId, userId } });
  if (!room) throw badRequest('找不到場地');
  if (d.memberId && !(await prisma.member.findFirst({ where: { id: d.memberId, userId } }))) throw badRequest('找不到會員');
  if (d.endTime <= d.startTime) throw badRequest('結束時間須晚於開始時間');
  const startsAt = localToUtc(d.date, d.startTime, studio.timezone);
  const endsAt = localToUtc(d.date, d.endTime, studio.timezone);
  const clash = await rentalConflict(userId, room.id, startsAt, endsAt, exceptId);
  if (clash) throw conflict(clash);
  const hours = (endsAt.getTime() - startsAt.getTime()) / 3600e3;
  const { date: _d, startTime: _s, endTime: _e, ...rest } = d;
  return { ...rest, startsAt, endsAt, price: d.price ?? Math.round(room.hourlyRate * hours) };
}

export async function createRental(req: AuthRequest, res: Response) {
  const d = rentalSchema.parse(req.body);
  res.status(201).json(await prisma.roomBooking.create({ data: { ...(await rentalData(req.userId!, d)), userId: req.userId! } }));
}
export async function updateRental(req: AuthRequest, res: Response) {
  const own = await prisma.roomBooking.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到租借');
  const body = z.object({ status: z.enum(['BOOKED', 'CANCELLED']).optional() }).passthrough().parse(req.body);
  if (body.status === 'CANCELLED' && Object.keys(body).length === 1) {
    res.json(await prisma.roomBooking.update({ where: { id: own.id }, data: { status: 'CANCELLED' } }));
    return;
  }
  const d = rentalSchema.parse(req.body);
  res.json(await prisma.roomBooking.update({ where: { id: own.id }, data: { ...(await rentalData(req.userId!, d, own.id)), status: body.status ?? own.status } }));
}
export async function deleteRental(req: AuthRequest, res: Response) {
  const own = await prisma.roomBooking.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到租借');
  await prisma.roomBooking.delete({ where: { id: own.id } });
  res.json({ ok: true });
}
