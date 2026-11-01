// 會員端（手機網頁）：登入、查看課表、預約、取消、查看方案與紀錄。所有資料都限定在會員自己所屬的教室
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { config } from '../config';
import { MemberRequest, signMemberToken } from '../middleware/memberAuth';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { bookSession, cancelBooking } from '../services/bookingService';
import { notifyBookingChanges } from '../services/notifyService';

// 正式環境（已設定 LIFF）：前端傳 LIFF accessToken，後端向 LINE 取得 userId 對應已綁定的會員。
// 沙盒環境：用教室提供的綁定碼登入（同時完成網頁端綁定）。
export async function memberLogin(req: Request, res: Response) {
  const { liffAccessToken, bindingCode } = req.body ?? {};
  if (config.liff.enabled && liffAccessToken) {
    const r = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${liffAccessToken}` } }).catch(() => null);
    if (!r?.ok) { res.status(401).json({ error: 'LINE 驗證失敗' }); return; }
    const profile = (await r.json()) as { userId: string };
    const members = await prisma.member.findMany({ where: { lineUserId: profile.userId, status: 'ACTIVE' }, select: { id: true, name: true } });
    if (!members.length) { res.status(404).json({ error: '尚未綁定，請向教室索取綁定碼' }); return; }
    res.json({ token: signMemberToken(members[0].id), member: members[0] });
    return;
  }
  if (bindingCode) {
    const code = String(bindingCode).trim().toUpperCase();
    const member = await prisma.member.findFirst({ where: { lineBindingCode: code, lineBindingCodeExpiry: { gt: new Date() }, status: 'ACTIVE' } });
    if (!member) { res.status(401).json({ error: '綁定碼無效或已過期，請向教室索取新的綁定碼' }); return; }
    res.json({ token: signMemberToken(member.id), member: { id: member.id, name: member.name } });
    return;
  }
  res.status(400).json({ error: '缺少登入資訊' });
}

export function memberAuthConfig(_req: Request, res: Response) {
  res.json({ liffEnabled: config.liff.enabled, liffId: config.liff.id });
}

async function currentMember(req: MemberRequest) {
  const m = await prisma.member.findUnique({ where: { id: req.memberId! } });
  if (!m || m.status !== 'ACTIVE') throw notFound('會員帳號不存在或已停用');
  return m;
}

export async function memberMe(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const studio = await getStudio(m.userId);
  const today = dateOnly(localDate(new Date(), studio.timezone));
  const passes = await prisma.membership.findMany({
    where: { memberId: m.id, status: { in: ['ACTIVE', 'FROZEN'] }, endDate: { gte: today } }, orderBy: { endDate: 'asc' },
  });
  res.json({
    member: { id: m.id, name: m.name, phone: m.phone },
    studio: { name: studio.name, phone: studio.phone, address: studio.address, cancelDeadlineHours: studio.cancelDeadlineHours, lateCancelForfeit: studio.lateCancelForfeit, bookingWindowDays: studio.bookingWindowDays, timezone: studio.timezone },
    passes,
  });
}

/** 可預約的課表：預約期間內的課程，附剩餘名額與自己的預約狀態 */
export async function memberSchedule(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const studio = await getStudio(m.userId);
  const today = localDate(new Date(), studio.timezone);
  const sessions = await prisma.classSession.findMany({
    where: {
      userId: m.userId, status: 'SCHEDULED',
      startsAt: { gt: new Date(), lt: localToUtc(addDays(today, studio.bookingWindowDays + 1), '00:00', studio.timezone) },
    },
    include: { classType: true, coach: { select: { name: true } }, bookings: { select: { status: true, memberId: true, id: true } } },
    orderBy: { startsAt: 'asc' },
  });
  res.json(sessions.map((s) => {
    const seated = s.bookings.filter((b) => ['BOOKED', 'ATTENDED'].includes(b.status)).length;
    const mine = s.bookings.find((b) => b.memberId === m.id && ['BOOKED', 'WAITLIST'].includes(b.status));
    return {
      id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, room: s.room,
      classType: { id: s.classType.id, name: s.classType.name, color: s.classType.color, creditCost: s.classType.creditCost },
      coach: s.coach?.name ?? null, capacity: s.capacity, spotsLeft: Math.max(0, s.capacity - seated),
      waitlist: s.bookings.filter((b) => b.status === 'WAITLIST').length,
      myBooking: mine ? { id: mine.id, status: mine.status } : null,
    };
  }));
}

export async function memberBook(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const { sessionId } = z.object({ sessionId: z.string() }).parse(req.body);
  res.status(201).json(await bookSession({ userId: m.userId, sessionId, memberId: m.id, source: 'MEMBER' }));
}

export async function memberCancel(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const r = await cancelBooking({ userId: m.userId, bookingId: req.params.id, by: 'MEMBER', memberId: m.id });
  await notifyBookingChanges(m.userId, r.promoted ? [r.promoted] : []);
  res.json({ status: r.booking.status, late: r.late, refunded: r.refunded });
}

export async function memberBookings(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const scope = z.enum(['upcoming', 'history']).catch('upcoming').parse(req.query.scope);
  const now = new Date();
  const list = await prisma.booking.findMany({
    where: { memberId: m.id, ...(scope === 'upcoming' ? { status: { in: ['BOOKED', 'WAITLIST'] }, session: { startsAt: { gt: now } } } : { session: { startsAt: { lte: now } } }) },
    include: { session: { include: { classType: true, coach: { select: { name: true } } } } },
    orderBy: { session: { startsAt: scope === 'upcoming' ? 'asc' : 'desc' } },
    take: 50,
  });
  if (!list) throw badRequest('查詢失敗');
  res.json(list.map((b) => ({ id: b.id, status: b.status, creditsCharged: b.creditsCharged, startsAt: b.session.startsAt, classType: b.session.classType.name, color: b.session.classType.color, coach: b.session.coach?.name ?? null, room: b.session.room })));
}
