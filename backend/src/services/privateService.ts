// 私人課：依教練每週可預約時段，扣掉已排的課，算出可預約的空檔；預約時建立一堂一人的課程
import { prisma } from '../app';
import { badRequest, conflict, notFound } from '../utils/http';
import { addDays, localDate, localToUtc, weekdayOf } from '../utils/time';
import { getStudio } from './studioService';
import { bookSession } from './bookingService';
import { BookingSource } from '@prisma/client';

const STEP_MIN = 30; // 空檔以 30 分鐘為單位

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** 某位教練某天可以開始私人課的時間點（教室當地 HH:MM） */
export async function privateSlots(userId: string, coachId: string, classTypeId: string, day: string) {
  const studio = await getStudio(userId);
  const [coach, ct] = await Promise.all([
    prisma.coach.findFirst({ where: { id: coachId, userId, active: true }, include: { availability: true } }),
    prisma.classType.findFirst({ where: { id: classTypeId, userId, active: true, isPrivate: true } }),
  ]);
  if (!coach) throw notFound('找不到教練');
  if (!ct) throw notFound('找不到私人課程');
  const ranges = coach.availability.filter((a) => a.weekday === weekdayOf(day));
  if (!ranges.length) return [];
  const dayStart = localToUtc(day, '00:00', studio.timezone);
  const dayEnd = localToUtc(addDays(day, 1), '00:00', studio.timezone);
  const busy = await prisma.classSession.findMany({
    where: { userId, coachId, status: 'SCHEDULED', startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
    select: { startsAt: true, endsAt: true },
  });
  const now = Date.now();
  const slots: string[] = [];
  for (const r of ranges) {
    for (let t = toMin(r.startTime); t + ct.durationMin <= toMin(r.endTime); t += STEP_MIN) {
      const s = localToUtc(day, toHm(t), studio.timezone).getTime();
      const e = s + ct.durationMin * 60e3;
      if (s <= now) continue;
      if (busy.some((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s)) continue;
      slots.push(toHm(t));
    }
  }
  return [...new Set(slots)].sort();
}

/** 預約私人課：再次確認是空檔後建立課程並預約（扣堂規則同團課） */
export async function bookPrivate(userId: string, input: { memberId: string; coachId: string; classTypeId: string; date: string; startTime: string; source: BookingSource }) {
  const studio = await getStudio(userId);
  if (input.source === 'MEMBER' && input.date > addDays(localDate(new Date(), studio.timezone), studio.bookingWindowDays)) {
    throw badRequest(`只能預約 ${studio.bookingWindowDays} 天內的課程`);
  }
  const slots = await privateSlots(userId, input.coachId, input.classTypeId, input.date);
  if (!slots.includes(input.startTime)) throw conflict('這個時段已經被預約或不開放，請選擇其他時間');
  const ct = await prisma.classType.findUniqueOrThrow({ where: { id: input.classTypeId } });
  const startsAt = localToUtc(input.date, input.startTime, studio.timezone);
  const endsAt = new Date(startsAt.getTime() + ct.durationMin * 60e3);
  // 以教練為單位上鎖後再檢查一次重疊，避免兩人同時搶同一個時段
  const session = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.coachId}))`;
    const overlap = await tx.classSession.count({ where: { userId, coachId: input.coachId, status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
    if (overlap) throw conflict('這個時段剛被預約走了，請選擇其他時間');
    return tx.classSession.create({
      data: { userId, classTypeId: ct.id, coachId: input.coachId, startsAt, endsAt, capacity: 1, isPrivate: true, note: '私人課' },
    });
  });
  try {
    return { session, booking: await bookSession({ userId, sessionId: session.id, memberId: input.memberId, source: input.source }) };
  } catch (e) {
    await prisma.classSession.delete({ where: { id: session.id } }); // 預約失敗（例如沒有可用方案）就不要留下空課
    throw e;
  }
}

/** 會員端：可預約的私人課類型，以及有設定可預約時段的教練 */
export async function privateOptions(userId: string) {
  const [types, coaches] = await Promise.all([
    prisma.classType.findMany({ where: { userId, active: true, isPrivate: true }, orderBy: { name: 'asc' } }),
    prisma.coach.findMany({ where: { userId, active: true, availability: { some: {} } }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } }),
  ]);
  return { types: types.map((t) => ({ id: t.id, name: t.name, color: t.color, durationMin: t.durationMin, creditCost: t.creditCost })), coaches };
}
