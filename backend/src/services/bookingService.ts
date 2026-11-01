// 預約核心規則：預約、候補、取消（退堂或晚取消扣堂）、候補遞補、點名、整堂取消。
// 每個會改變名額或堂數的動作都在同一個交易中，並鎖住課程（與方案）資料列，避免兩人同時搶到最後一個名額。
import { Prisma, Booking, BookingSource, Membership } from '@prisma/client';
import { prisma } from '../app';
import { badRequest, conflict, notFound } from '../utils/http';
import { addDays, dateOnly, localDate, localToUtc } from '../utils/time';
import { getStudio } from './studioService';

type Tx = Prisma.TransactionClient;
const SEATED = ['BOOKED', 'ATTENDED'] as const; // 占用名額的狀態

async function lockSession(tx: Tx, userId: string, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${sessionId} FOR UPDATE`;
  const session = await tx.classSession.findFirst({ where: { id: sessionId, userId }, include: { classType: true } });
  if (!session) throw notFound('找不到這堂課');
  return session;
}

/**
 * 找出這位會員上這堂課可以使用的方案：有效期間涵蓋上課日、未凍結、適用此課程類型、堂數足夠、未超過每日上限。
 * 多張可用時，優先使用最快到期的（避免浪費）；同一天到期時先用期限卡，不消耗堂數卡。
 */
export async function findUsableMembership(
  tx: Tx, userId: string, memberId: string,
  session: { id: string; startsAt: Date; classTypeId: string; classType: { creditCost: number } },
  timeZone: string,
): Promise<Membership | null> {
  const day = localDate(session.startsAt, timeZone);
  const candidates = await tx.membership.findMany({
    where: {
      userId, memberId, status: 'ACTIVE',
      startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) },
    },
    orderBy: [{ endDate: 'asc' }, { createdAt: 'asc' }],
  });
  const cost = session.classType.creditCost;
  const usable: Membership[] = [];
  for (const m of candidates) {
    if (m.classTypeIds.length && !m.classTypeIds.includes(session.classTypeId)) continue;
    // 凍結期間中的上課日不能使用
    if (m.frozenFrom && m.frozenUntil && dateOnly(day) >= m.frozenFrom && dateOnly(day) <= m.frozenUntil) continue;
    if (m.kind !== 'PERIOD' && (m.creditsLeft ?? 0) < cost) continue;
    if (m.kind === 'PERIOD' && m.dailyLimit) {
      // 當地這一天的起訖（UTC），計算同一天已用這張卡預約幾堂
      const used = await tx.booking.count({
        where: {
          membershipId: m.id, status: { in: [...SEATED, 'LATE_CANCELLED'] }, NOT: { sessionId: session.id },
          session: { startsAt: { gte: localToUtc(day, '00:00', timeZone), lt: localToUtc(addDays(day, 1), '00:00', timeZone) } },
        },
      });
      if (used >= m.dailyLimit) continue;
    }
    usable.push(m);
  }
  // 同一天到期時期限卡排前面（不消耗堂數）
  usable.sort((a, b) => a.endDate.getTime() - b.endDate.getTime() || Number(b.kind === 'PERIOD') - Number(a.kind === 'PERIOD'));
  return usable[0] ?? null;
}

/** 從方案扣堂（堂數卡、單堂）；期限卡不扣。回傳實際扣的堂數 */
async function charge(tx: Tx, membership: Membership, cost: number): Promise<number> {
  if (membership.kind === 'PERIOD') return 0;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE id = ${membership.id} FOR UPDATE`;
  const fresh = await tx.membership.findUniqueOrThrow({ where: { id: membership.id } });
  if ((fresh.creditsLeft ?? 0) < cost) throw conflict('方案剩餘堂數不足');
  await tx.membership.update({ where: { id: membership.id }, data: { creditsLeft: { decrement: cost } } });
  return cost;
}

async function refund(tx: Tx, booking: Booking) {
  if (booking.membershipId && booking.creditsCharged > 0) {
    await tx.membership.update({ where: { id: booking.membershipId }, data: { creditsLeft: { increment: booking.creditsCharged } } });
  }
}

export interface BookInput {
  userId: string;
  sessionId: string;
  memberId: string;
  source: BookingSource;
}

/** 預約：有名額且有可用方案就正取並扣堂；額滿時排入候補（候補不扣堂，遞補時才扣） */
export async function bookSession({ userId, sessionId, memberId, source }: BookInput) {
  const studio = await getStudio(userId);
  return prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, userId, sessionId);
    if (session.status !== 'SCHEDULED') throw badRequest('這堂課已取消');
    const now = new Date();
    if (source === 'MEMBER') {
      if (session.startsAt <= now) throw badRequest('課程已開始，無法預約');
      if (session.startsAt.getTime() - now.getTime() > (studio.bookingWindowDays + 1) * 86400e3) throw badRequest(`只能預約 ${studio.bookingWindowDays} 天內的課程`);
    } else if (session.endsAt <= now) {
      throw badRequest('課程已結束，無法預約');
    }

    const member = await tx.member.findFirst({ where: { id: memberId, userId } });
    if (!member) throw notFound('找不到會員');
    if (member.status !== 'ACTIVE') throw badRequest('此會員已停用');

    const existing = await tx.booking.findUnique({ where: { sessionId_memberId: { sessionId, memberId } } });
    if (existing && ['BOOKED', 'WAITLIST', 'ATTENDED'].includes(existing.status)) {
      throw conflict(existing.status === 'WAITLIST' ? '已在候補名單中' : '已經預約過這堂課');
    }

    const membership = await findUsableMembership(tx, userId, memberId, session, studio.timezone);
    if (!membership) throw badRequest('沒有可用的方案：可能已過期、堂數不足、凍結中，或方案不適用這堂課');

    const seated = await tx.booking.count({ where: { sessionId, status: { in: [...SEATED] } } });
    let data: Prisma.BookingUncheckedCreateInput;
    if (seated < session.capacity) {
      const credits = await charge(tx, membership, session.classType.creditCost);
      data = { userId, sessionId, memberId, membershipId: membership.id, status: 'BOOKED', creditsCharged: credits, source };
    } else if (studio.waitlistEnabled) {
      data = { userId, sessionId, memberId, membershipId: null, status: 'WAITLIST', creditsCharged: 0, source };
    } else {
      throw conflict('這堂課已額滿');
    }

    // 同一會員之前取消過同一堂課：沿用原紀錄（唯一鍵為 課程＋會員）
    const fields = { ...data, bookedAt: now, cancelledAt: null, checkedInAt: null, promotedAt: null };
    return existing
      ? tx.booking.update({ where: { id: existing.id }, data: fields })
      : tx.booking.create({ data: fields });
  });
}

/** 名額釋出後依候補順序遞補；遇到沒有可用方案的人就跳過。回傳被遞補的預約 */
async function promoteWaitlist(tx: Tx, userId: string, session: Awaited<ReturnType<typeof lockSession>>, timeZone: string) {
  if (session.status !== 'SCHEDULED' || session.startsAt <= new Date()) return null;
  const seated = await tx.booking.count({ where: { sessionId: session.id, status: { in: [...SEATED] } } });
  if (seated >= session.capacity) return null;
  const queue = await tx.booking.findMany({ where: { sessionId: session.id, status: 'WAITLIST' }, orderBy: { bookedAt: 'asc' } });
  for (const w of queue) {
    const m = await findUsableMembership(tx, userId, w.memberId, session, timeZone);
    if (!m) continue;
    const credits = await charge(tx, m, session.classType.creditCost);
    return tx.booking.update({
      where: { id: w.id },
      data: { status: 'BOOKED', membershipId: m.id, creditsCharged: credits, promotedAt: new Date() },
    });
  }
  return null;
}

export interface CancelResult { booking: Booking; late: boolean; refunded: boolean; promoted: Booking | null }

/**
 * 取消預約。開課前「取消截止時間」之前取消一律退堂；之後取消算晚取消，依教室設定扣堂。
 * 教室人員可以 forceRefund 例外退堂（例如會員生病）。正取取消後會自動遞補候補。
 */
export async function cancelBooking(opts: { userId: string; bookingId: string; by: BookingSource; forceRefund?: boolean; memberId?: string }): Promise<CancelResult> {
  const studio = await getStudio(opts.userId);
  return prisma.$transaction(async (tx) => {
    const found = await tx.booking.findFirst({ where: { id: opts.bookingId, userId: opts.userId, ...(opts.memberId ? { memberId: opts.memberId } : {}) } });
    if (!found) throw notFound('找不到預約');
    const session = await lockSession(tx, opts.userId, found.sessionId);
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: found.id } }); // 鎖住課程後重讀，確保狀態最新
    const now = new Date();
    if (opts.by === 'MEMBER' && session.startsAt <= now) throw badRequest('課程已開始，無法取消，請聯絡教室');

    if (booking.status === 'WAITLIST') {
      const b = await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED', cancelledAt: now } });
      return { booking: b, late: false, refunded: false, promoted: null };
    }
    if (booking.status !== 'BOOKED') throw badRequest('這筆預約目前無法取消');

    const deadline = new Date(session.startsAt.getTime() - studio.cancelDeadlineHours * 3600e3);
    const late = now > deadline;
    const forfeit = late && studio.lateCancelForfeit && !(opts.by === 'STAFF' && opts.forceRefund);
    if (!forfeit) await refund(tx, booking);
    const b = await tx.booking.update({
      where: { id: booking.id },
      data: { status: forfeit ? 'LATE_CANCELLED' : 'CANCELLED', cancelledAt: now, creditsCharged: forfeit ? booking.creditsCharged : 0 },
    });
    const promoted = await promoteWaitlist(tx, opts.userId, session, studio.timezone);
    return { booking: b, late, refunded: !forfeit, promoted };
  });
}

/** 點名：正取 → 出席。也可修正誤標的未到。undo 時回到正取 */
export async function setAttendance(userId: string, bookingId: string, action: 'attend' | 'noshow' | 'undo') {
  const b = await prisma.booking.findFirst({ where: { id: bookingId, userId } });
  if (!b) throw notFound('找不到預約');
  const allowed: Record<string, string[]> = { attend: ['BOOKED', 'NO_SHOW'], noshow: ['BOOKED', 'ATTENDED'], undo: ['ATTENDED', 'NO_SHOW'] };
  if (!allowed[action].includes(b.status)) throw badRequest('目前狀態無法執行這個動作');
  const status = action === 'attend' ? 'ATTENDED' : action === 'noshow' ? 'NO_SHOW' : 'BOOKED';
  return prisma.booking.update({ where: { id: b.id }, data: { status, checkedInAt: action === 'attend' ? new Date() : null } });
}

/** 教室取消整堂課：所有正取退堂、候補一併取消。回傳受影響的預約（用來通知） */
export async function cancelSession(userId: string, sessionId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, userId, sessionId);
    if (session.status === 'CANCELLED') throw badRequest('這堂課已經取消');
    const active = await tx.booking.findMany({ where: { sessionId, status: { in: ['BOOKED', 'WAITLIST'] } } });
    for (const b of active) {
      if (b.status === 'BOOKED') await refund(tx, b);
      await tx.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), creditsCharged: 0 } });
    }
    await tx.classSession.update({ where: { id: sessionId }, data: { status: 'CANCELLED', cancelReason: reason || null } });
    return active;
  });
}

/** 調整名額：加大時自動遞補候補；縮小不能低於已正取人數 */
export async function updateCapacity(userId: string, sessionId: string, capacity: number) {
  const studio = await getStudio(userId);
  return prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, userId, sessionId);
    const seated = await tx.booking.count({ where: { sessionId, status: { in: [...SEATED] } } });
    if (capacity < seated) throw badRequest(`已有 ${seated} 人正取，名額不能少於 ${seated}`);
    const updated = await tx.classSession.update({ where: { id: sessionId }, data: { capacity }, include: { classType: true } });
    const promoted: Booking[] = [];
    for (let i = seated; i < capacity; i++) {
      const p = await promoteWaitlist(tx, userId, { ...updated, classType: session.classType }, studio.timezone);
      if (!p) break;
      promoted.push(p);
    }
    return { session: updated, promoted };
  });
}

/**
 * 課程結束後的收尾（排程每 10 分鐘執行）：
 * 沒點名的正取依教室設定視為出席或未到；開課後仍在候補的取消（不扣堂）。
 */
export async function closeFinishedSessions(now = new Date()) {
  const ended = await prisma.classSession.findMany({
    where: { status: 'SCHEDULED', endsAt: { lt: new Date(now.getTime() - 30 * 60e3) }, bookings: { some: { status: { in: ['BOOKED', 'WAITLIST'] } } } },
    select: { id: true, userId: true },
    take: 500,
  });
  let attended = 0, noShow = 0, dropped = 0;
  for (const s of ended) {
    const studio = await getStudio(s.userId);
    const r = await prisma.booking.updateMany({
      where: { sessionId: s.id, status: 'BOOKED' },
      data: studio.autoAttend ? { status: 'ATTENDED' } : { status: 'NO_SHOW' },
    });
    if (studio.autoAttend) attended += r.count; else noShow += r.count;
    dropped += (await prisma.booking.updateMany({ where: { sessionId: s.id, status: 'WAITLIST' }, data: { status: 'CANCELLED', cancelledAt: now } })).count;
  }
  return { sessions: ended.length, attended, noShow, dropped };
}
