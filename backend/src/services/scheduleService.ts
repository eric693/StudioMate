// 依固定課表自動產生未來的課程。唯一鍵（固定課表＋開始時間）讓重複執行不會重複建立
import { prisma } from '../app';
import { addDays, dateOnlyStr, localDate, localToUtc, weekdayOf } from '../utils/time';
import { getStudio } from './studioService';

export async function generateSessions(userId: string, days?: number) {
  const studio = await getStudio(userId);
  const horizon = days ?? studio.bookingWindowDays;
  const today = localDate(new Date(), studio.timezone);
  const templates = await prisma.scheduleTemplate.findMany({ where: { userId }, include: { classType: true } });
  const now = new Date();
  const rows = [];
  for (let i = 0; i <= horizon; i++) {
    const day = addDays(today, i);
    const wd = weekdayOf(day);
    for (const t of templates) {
      if (t.weekday !== wd || !t.classType.active) continue;
      if (day < dateOnlyStr(t.activeFrom) || (t.activeTo && day > dateOnlyStr(t.activeTo))) continue;
      const startsAt = localToUtc(day, t.startTime, studio.timezone);
      if (startsAt <= now) continue;
      rows.push({
        userId, classTypeId: t.classTypeId, coachId: t.coachId, templateId: t.id, room: t.room, branchId: t.branchId, liveUrl: t.liveUrl,
        startsAt, endsAt: new Date(startsAt.getTime() + t.durationMin * 60e3), capacity: t.capacity,
      });
    }
  }
  const r = rows.length ? await prisma.classSession.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  return { created: r.count };
}

/**
 * 固定課表修改或刪除後：刪除這個課表未來「還沒有人預約」的課程，再重新產生。
 * 已經有人預約的課程保留不動（避免學員的預約憑空消失），由教室人員自行調整。
 */
export async function resyncTemplate(userId: string, templateId: string, regenerate = true) {
  const removed = await prisma.classSession.deleteMany({
    where: { userId, templateId, startsAt: { gt: new Date() }, status: 'SCHEDULED', bookings: { none: {} } },
  });
  const kept = await prisma.classSession.count({ where: { userId, templateId, startsAt: { gt: new Date() }, status: 'SCHEDULED' } });
  const gen = regenerate ? await generateSessions(userId) : { created: 0 };
  return { removed: removed.count, kept, created: gen.created };
}

export async function generateAllStudios() {
  const studios = await prisma.studio.findMany({ select: { userId: true } });
  let created = 0;
  for (const s of studios) created += (await generateSessions(s.userId)).created;
  return { created };
}
