// 總覽與營收報表
import { Response } from 'express';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { addDays, dateOnly, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { DELETED } from './scheduleController';
import { revenueBreakdown } from './engageController';

export async function getDashboard(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const studio = await getStudio(userId);
  const tz = studio.timezone;
  const today = localDate(new Date(), tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const dayStart = localToUtc(today, '00:00', tz), dayEnd = localToUtc(addDays(today, 1), '00:00', tz);

  const [sessions, activeMembers, monthSales, expiring, lowCredits, recent] = await Promise.all([
    prisma.classSession.findMany({
      where: { userId, startsAt: { gte: dayStart, lt: dayEnd }, NOT: { status: 'CANCELLED', cancelReason: DELETED } },
      include: { classType: true, coach: true, bookings: { select: { status: true } } },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.member.count({ where: { userId, status: 'ACTIVE', memberships: { some: { status: { in: ['ACTIVE', 'FROZEN'] }, endDate: { gte: dateOnly(today) } } } } }),
    prisma.membership.aggregate({
      where: { userId, status: { not: 'CANCELLED' }, paidAt: { gte: localToUtc(monthStart, '00:00', tz) } },
      _sum: { price: true }, _count: true,
    }),
    prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, studio.expiryRemindDays)) } },
      include: { member: { select: { id: true, name: true, phone: true } } }, orderBy: { endDate: 'asc' }, take: 20,
    }),
    prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', kind: 'PACK', creditsLeft: { lte: studio.lowCreditThreshold }, endDate: { gte: dateOnly(today) } },
      include: { member: { select: { id: true, name: true, phone: true } } }, orderBy: { creditsLeft: 'asc' }, take: 20,
    }),
    // 近 30 天出席率：出席 ÷（出席＋未到＋晚取消）
    prisma.booking.groupBy({
      by: ['status'],
      where: { userId, session: { startsAt: { gte: new Date(Date.now() - 30 * 86400e3), lt: new Date() } } },
      _count: true,
    }),
  ]);

  const count = (s: string) => recent.find((r) => r.status === s)?._count ?? 0;
  const denominator = count('ATTENDED') + count('NO_SHOW') + count('LATE_CANCELLED');
  res.json({
    studioName: studio.name,
    today,
    sessions: sessions.map(({ bookings, ...s }) => ({
      ...s,
      booked: bookings.filter((b) => ['BOOKED', 'ATTENDED'].includes(b.status)).length,
      waitlist: bookings.filter((b) => b.status === 'WAITLIST').length,
      attended: bookings.filter((b) => b.status === 'ATTENDED').length,
    })),
    stats: {
      activeMembers,
      monthRevenue: monthSales._sum.price ?? 0,
      monthSales: monthSales._count,
      attendanceRate30d: denominator ? Math.round((count('ATTENDED') / denominator) * 100) : null,
      bookings30d: count('ATTENDED') + count('NO_SHOW') + count('LATE_CANCELLED') + count('BOOKED'),
    },
    expiring,
    lowCredits,
  });
}

/** 營收報表：近 12 個月的月營收，以及依方案的銷售統計 */
export async function getRevenueReport(req: AuthRequest, res: Response) {
  const userId = req.userId!;
  const studio = await getStudio(userId);
  const today = localDate(new Date(), studio.timezone);
  const months: string[] = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const since = localToUtc(`${months[0]}-01`, '00:00', studio.timezone);
  const sales = await prisma.membership.findMany({
    where: { userId, status: { not: 'CANCELLED' }, paidAt: { gte: since } },
    select: { price: true, paidAt: true, planName: true, payMethod: true },
  });
  const byMonth = Object.fromEntries(months.map((k) => [k, { month: k, revenue: 0, count: 0 }]));
  const byPlan: Record<string, { planName: string; revenue: number; count: number }> = {};
  const byMethod: Record<string, number> = {};
  for (const s of sales) {
    const k = localDate(s.paidAt, studio.timezone).slice(0, 7);
    if (byMonth[k]) { byMonth[k].revenue += s.price; byMonth[k].count++; }
    byPlan[s.planName] ??= { planName: s.planName, revenue: 0, count: 0 };
    byPlan[s.planName].revenue += s.price; byPlan[s.planName].count++;
    byMethod[s.payMethod] = (byMethod[s.payMethod] ?? 0) + s.price;
  }
  // 其他收入（商品、置物櫃、場地租借）與退費，合計為淨營收
  const extra = await revenueBreakdown(userId);
  res.json({
    months: Object.values(byMonth).map((x) => {
      const e = extra[x.month] ?? { products: 0, lockers: 0, rentals: 0, refunds: 0 };
      return { ...x, ...e, net: x.revenue + e.products + e.lockers + e.rentals - e.refunds };
    }),
    plans: Object.values(byPlan).sort((a, b) => b.revenue - a.revenue),
    methods: byMethod,
  });
}
