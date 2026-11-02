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
import { suspendedUntil } from '../services/bookingService';
import { assertTermsAccepted } from './commerceController';

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
  const [branches, privateTypes, shopPlans, suspended] = await Promise.all([
    prisma.branch.findMany({ where: { userId: m.userId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.classType.count({ where: { userId: m.userId, active: true, isPrivate: true } }),
    prisma.plan.count({ where: { userId: m.userId, active: true, onlineSale: true } }),
    suspendedUntil(prisma, studio, m.id),
  ]);
  const termsOutdated = Boolean(studio.terms) && studio.termsVersion > m.termsAcceptedVersion;
  res.json({
    member: {
      id: m.id, name: m.name, phone: m.phone, email: m.email, calendarToken: m.calendarToken,
      invoiceCarrierType: m.invoiceCarrierType, invoiceCarrierNum: m.invoiceCarrierNum, invoiceTaxId: m.invoiceTaxId, invoiceTitle: m.invoiceTitle,
    },
    studio: {
      name: studio.name, phone: studio.phone, address: studio.address, cancelDeadlineHours: studio.cancelDeadlineHours, lateCancelForfeit: studio.lateCancelForfeit,
      bookingWindowDays: studio.bookingWindowDays, timezone: studio.timezone, selfCheckIn: studio.selfCheckIn, invoiceEnabled: studio.invoiceEnabled,
      referralReward: studio.referralRewardAmount,
    },
    features: { shop: shopPlans > 0 && (studio.onlinePayEnabled || studio.transferEnabled), private: privateTypes > 0, branches },
    terms: termsOutdated ? { text: studio.terms, version: studio.termsVersion } : null,
    suspendedUntil: suspended,
    passes,
  });
}

export async function acceptTerms(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const studio = await getStudio(m.userId);
  const { version } = z.object({ version: z.number().int() }).parse(req.body);
  if (version !== studio.termsVersion) throw badRequest('條款已更新，請重新閱讀');
  await prisma.member.update({ where: { id: m.id }, data: { termsAcceptedVersion: version, termsAcceptedAt: new Date() } });
  res.json({ ok: true });
}

/** 會員自己修改 Email 與發票載具 */
export async function updateMemberProfile(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const d = z.object({
    email: z.string().trim().email('Email 格式不正確').nullable().optional().or(z.literal('').transform(() => null)),
    invoiceCarrierType: z.enum(['MOBILE', 'CITIZEN', 'DONATE', 'COMPANY']).nullable().optional().or(z.literal('').transform(() => null)),
    invoiceCarrierNum: z.string().trim().max(64).nullable().optional(),
    invoiceTaxId: z.string().trim().regex(/^\d{8}$/, '統一編號須為 8 碼數字').nullable().optional().or(z.literal('').transform(() => null)),
    invoiceTitle: z.string().trim().max(60).nullable().optional(),
  }).superRefine((v, ctx) => {
    if (v.invoiceCarrierType === 'MOBILE' && v.invoiceCarrierNum && !/^\/[0-9A-Z.+-]{7}$/.test(v.invoiceCarrierNum)) ctx.addIssue({ code: 'custom', path: ['invoiceCarrierNum'], message: '手機條碼格式為 / 開頭共 8 碼' });
    if (v.invoiceCarrierType === 'CITIZEN' && v.invoiceCarrierNum && !/^[A-Z]{2}\d{14}$/.test(v.invoiceCarrierNum)) ctx.addIssue({ code: 'custom', path: ['invoiceCarrierNum'], message: '自然人憑證條碼格式為 2 碼英文加 14 碼數字' });
    if (v.invoiceCarrierType === 'DONATE' && v.invoiceCarrierNum && !/^\d{3,7}$/.test(v.invoiceCarrierNum)) ctx.addIssue({ code: 'custom', path: ['invoiceCarrierNum'], message: '愛心碼為 3～7 碼數字' });
    if (v.invoiceCarrierType === 'COMPANY' && !v.invoiceTaxId) ctx.addIssue({ code: 'custom', path: ['invoiceTaxId'], message: '請填寫統一編號' });
  }).parse(req.body);
  await prisma.member.update({ where: { id: m.id }, data: d });
  res.json({ ok: true });
}

/** 可預約的課表：預約期間內的課程，附剩餘名額與自己的預約狀態 */
export async function memberSchedule(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  const studio = await getStudio(m.userId);
  const today = localDate(new Date(), studio.timezone);
  const sessions = await prisma.classSession.findMany({
    where: {
      userId: m.userId, status: 'SCHEDULED', isPrivate: false,
      startsAt: { gt: new Date(), lt: localToUtc(addDays(today, studio.bookingWindowDays + 1), '00:00', studio.timezone) },
    },
    include: { classType: true, coach: { select: { name: true } }, branch: { select: { id: true, name: true } }, bookings: { select: { status: true, memberId: true, id: true } } },
    orderBy: { startsAt: 'asc' },
  });
  res.json(sessions.map((s) => {
    const seated = s.bookings.filter((b) => ['BOOKED', 'ATTENDED'].includes(b.status)).length;
    const mine = s.bookings.find((b) => b.memberId === m.id && ['BOOKED', 'WAITLIST'].includes(b.status));
    return {
      id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, room: s.room,
      classType: { id: s.classType.id, name: s.classType.name, color: s.classType.color, creditCost: s.classType.creditCost, isOnline: s.classType.isOnline },
      branch: s.branch, live: Boolean(s.liveUrl),
      coach: s.coach?.name ?? null, capacity: s.capacity, spotsLeft: Math.max(0, s.capacity - seated),
      waitlist: s.bookings.filter((b) => b.status === 'WAITLIST').length,
      myBooking: mine ? { id: mine.id, status: mine.status } : null,
    };
  }));
}

export async function memberBook(req: MemberRequest, res: Response) {
  const m = await currentMember(req);
  await assertTermsAccepted(m.id);
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
    // 即將上課：還沒下課的都算（直播課開課後仍要能進入）；過去紀錄：已經下課的
    where: { memberId: m.id, ...(scope === 'upcoming' ? { status: { in: ['BOOKED', 'WAITLIST', 'ATTENDED'] }, session: { endsAt: { gt: now } } } : { session: { endsAt: { lte: now } } }) },
    include: { session: { include: { classType: true, coach: { select: { name: true } }, branch: { select: { name: true } } } } },
    orderBy: { session: { startsAt: scope === 'upcoming' ? 'asc' : 'desc' } },
    take: 50,
  });
  if (!list) throw badRequest('查詢失敗');
  res.json(list.map((b) => ({ id: b.id, status: b.status, creditsCharged: b.creditsCharged, startsAt: b.session.startsAt, classType: b.session.classType.name, color: b.session.classType.color, coach: b.session.coach?.name ?? null, room: b.session.room,
    endsAt: b.session.endsAt, live: Boolean(b.session.liveUrl), isPrivate: b.session.isPrivate, branch: b.session.branch?.name ?? null })));
}
