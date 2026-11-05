// 門禁（會員動態 QR code、閘門裝置 API、櫃檯掃碼）、置物櫃、體組成紀錄
import crypto from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Studio } from '@prisma/client';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { MemberRequest } from '../middleware/memberAuth';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, dateOnlyStr, formatLocal, localDate } from '../utils/time';
import { getStudio } from '../services/studioService';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');
const payMethod = z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']);

/* ---------- 會員入場 QR code ---------- */

// QR code 每 30 秒換一次，前後各容許 2 個週期（避免截圖轉傳）
const STEP_MS = 30_000;
const sign = (secret: string, memberId: string, step: number) => crypto.createHmac('sha256', secret).update(`${memberId}.${step}`).digest('base64url').slice(0, 12);

export function memberAccessCode(studio: Studio, memberId: string, now = Date.now()) {
  const step = Math.floor(now / STEP_MS);
  return { code: `SM1.${memberId}.${step}.${sign(studio.accessSecret, memberId, step)}`, expiresInSec: Math.ceil(((step + 1) * STEP_MS - now) / 1000) };
}

/** 解析 QR code 內容，回傳會員 id；格式錯誤或過期回傳 null */
async function parseAccessCode(userId: string, code: string): Promise<string | null> {
  const m = /^SM1\.([a-z0-9]+)\.(\d+)\.([A-Za-z0-9_-]{12})$/.exec(code.trim());
  if (!m) return null;
  const studio = await getStudio(userId);
  const [, memberId, stepStr, sig] = m;
  const step = Number(stepStr);
  if (Math.abs(Math.floor(Date.now() / STEP_MS) - step) > 2) return null;
  const expected = sign(studio.accessSecret, memberId, step);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return memberId;
}

export async function portalAccessCode(req: MemberRequest, res: Response) {
  const m = await prisma.member.findUnique({ where: { id: req.memberId! } });
  if (!m || m.status !== 'ACTIVE') throw notFound('會員帳號不存在或已停用');
  res.json(memberAccessCode(await getStudio(m.userId), m.id));
}

/**
 * 入場判斷：會員使用中、有有效方案（期限卡，或堂數卡還有堂數，或今天有預約），不在凍結中。
 * 允許入場時，若有即將開始的預約課程且教室開啟「入場自動簽到」，一併簽到。
 */
export async function checkAccess(userId: string, memberId: string | null, deviceId: string | null) {
  const studio = await getStudio(userId);
  const log = async (allowed: boolean, reason: string, mid: string | null = memberId) => {
    await prisma.accessLog.create({ data: { userId, memberId: mid, deviceId, allowed, reason } });
  };
  if (!memberId) { await log(false, 'QR code 無效或已過期', null); return { allowed: false, reason: 'QR code 無效或已過期，請會員重新開啟入場碼' }; }
  const member = await prisma.member.findFirst({ where: { id: memberId, userId } });
  if (!member) { await log(false, '非本教室會員', null); return { allowed: false, reason: '非本教室會員' }; }
  if (member.status !== 'ACTIVE') { await log(false, '會員已停用'); return { allowed: false, reason: '會員已停用', member: { id: member.id, name: member.name } }; }
  const today = localDate(new Date(), studio.timezone);
  const passes = await prisma.membership.findMany({ where: { memberId, status: { in: ['ACTIVE', 'FROZEN'] }, startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } } });
  const now = new Date();
  const booking = await prisma.booking.findFirst({
    where: { memberId, status: { in: ['BOOKED', 'ATTENDED'] }, session: { status: 'SCHEDULED', startsAt: { lte: new Date(now.getTime() + Math.max(studio.checkInBeforeMin, 60) * 60e3) }, endsAt: { gte: now } } },
    include: { session: { include: { classType: true } } }, orderBy: { session: { startsAt: 'asc' } },
  });
  const usable = passes.filter((p) => p.status === 'ACTIVE' && (p.kind === 'PERIOD' || (p.creditsLeft ?? 0) > 0));
  const info = { id: member.id, name: member.name };
  if (!usable.length && !booking) {
    const reason = passes.some((p) => p.status === 'FROZEN') ? '方案凍結中' : passes.length ? '堂數已用完' : '沒有有效方案';
    await log(false, reason);
    return { allowed: false, reason, member: info };
  }
  let checkedIn: string | null = null;
  if (booking && studio.accessAutoCheckIn) {
    if (booking.status === 'BOOKED') await prisma.booking.update({ where: { id: booking.id }, data: { status: 'ATTENDED', checkedInAt: now } });
    checkedIn = `${formatLocal(booking.session.startsAt, studio.timezone)} ${booking.session.classType.name}`;
  }
  const pass = usable[0];
  const summary = pass ? `${pass.planName}・${pass.kind === 'PERIOD' ? '' : `剩 ${pass.creditsLeft} 堂・`}${dateOnlyStr(pass.endDate)} 到期` : '今日預約入場';
  await log(true, checkedIn ? `入場並簽到：${checkedIn}` : '入場');
  return { allowed: true, reason: summary, member: info, checkedIn };
}

/** 閘門／電子鎖等裝置呼叫：Header X-Device-Token 或 body.deviceToken */
export async function deviceCheck(req: Request, res: Response) {
  const token = String(req.headers['x-device-token'] ?? req.body?.deviceToken ?? '');
  const device = token ? await prisma.accessDevice.findUnique({ where: { token } }) : null;
  if (!device || !device.active) { res.status(401).json({ allowed: false, reason: '裝置未授權' }); return; }
  const { code } = z.object({ code: z.string().max(200) }).parse(req.body);
  await prisma.accessDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  res.json(await checkAccess(device.userId, await parseAccessCode(device.userId, code), device.id));
}

/** 櫃檯掃碼（USB 掃碼器或手動選會員） */
export async function staffScan(req: AuthRequest, res: Response) {
  const d = z.object({ code: z.string().max(200).optional(), memberId: z.string().optional() }).parse(req.body);
  const memberId = d.memberId ?? (d.code ? await parseAccessCode(req.userId!, d.code) : null);
  res.json(await checkAccess(req.userId!, memberId, null));
}

export async function listAccessLogs(req: AuthRequest, res: Response) {
  const f = z.object({ memberId: z.string().optional(), allowed: z.enum(['yes', 'no']).optional() }).parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  res.json(await prisma.accessLog.findMany({
    where: { userId: req.userId!, ...(f.memberId ? { memberId: f.memberId } : {}), ...(f.allowed ? { allowed: f.allowed === 'yes' } : {}) },
    include: { member: { select: { id: true, name: true } }, device: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }, take: 300,
  }));
}

export async function listDevices(req: AuthRequest, res: Response) {
  res.json(await prisma.accessDevice.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'asc' } }));
}
export async function createDevice(req: AuthRequest, res: Response) {
  const d = z.object({ name: z.string().trim().min(1, '請填寫裝置名稱').max(40), branchId: z.string().nullable().optional() }).parse(req.body);
  res.status(201).json(await prisma.accessDevice.create({ data: { ...d, userId: req.userId!, token: crypto.randomBytes(24).toString('base64url') } }));
}
export async function updateDevice(req: AuthRequest, res: Response) {
  const own = await prisma.accessDevice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到裝置');
  const d = z.object({ name: z.string().trim().min(1).max(40).optional(), active: z.boolean().optional(), rotate: z.boolean().optional() }).parse(req.body);
  res.json(await prisma.accessDevice.update({
    where: { id: own.id },
    data: { name: d.name, active: d.active, ...(d.rotate ? { token: crypto.randomBytes(24).toString('base64url') } : {}) },
  }));
}
export async function deleteDevice(req: AuthRequest, res: Response) {
  const own = await prisma.accessDevice.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到裝置');
  await prisma.accessDevice.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/* ---------- 置物櫃 ---------- */

const lockerSchema = z.object({
  code: z.string().trim().min(1, '請填寫櫃號').max(20), size: z.string().trim().max(20).nullable().optional(), branchId: z.string().nullable().optional(),
  monthlyRate: z.coerce.number().int().min(0).max(100000).optional(), active: z.boolean().optional(), note: z.string().max(200).nullable().optional(),
});

export async function listLockers(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const today = dateOnly(localDate(new Date(), studio.timezone));
  const lockers = await prisma.locker.findMany({
    where: { userId: req.userId! },
    include: { rentals: { where: { status: 'ACTIVE' }, include: { member: { select: { id: true, name: true, phone: true } } }, orderBy: { endDate: 'desc' } } },
    orderBy: { code: 'asc' },
  });
  res.json(lockers.map(({ rentals, ...l }) => ({ ...l, rental: rentals[0] ?? null, overdue: Boolean(rentals[0] && rentals[0].endDate < today) })));
}
export async function createLocker(req: AuthRequest, res: Response) {
  const d = lockerSchema.parse(req.body);
  res.status(201).json(await prisma.locker.create({ data: { ...d, userId: req.userId! } }));
}
/** 批次新增：例如 A01 ~ A20 */
export async function bulkLockers(req: AuthRequest, res: Response) {
  const d = z.object({ prefix: z.string().trim().max(10), from: z.coerce.number().int().min(0).max(9999), to: z.coerce.number().int().min(0).max(9999), digits: z.coerce.number().int().min(1).max(4).optional(), size: z.string().max(20).optional(), monthlyRate: z.coerce.number().int().min(0).optional() }).parse(req.body);
  if (d.to < d.from || d.to - d.from > 300) throw badRequest('一次最多新增 300 個置物櫃');
  const r = await prisma.locker.createMany({
    data: Array.from({ length: d.to - d.from + 1 }, (_, i) => ({ userId: req.userId!, code: `${d.prefix}${String(d.from + i).padStart(d.digits ?? 2, '0')}`, size: d.size, monthlyRate: d.monthlyRate ?? 0 })),
    skipDuplicates: true,
  });
  res.status(201).json({ created: r.count });
}
export async function updateLocker(req: AuthRequest, res: Response) {
  const own = await prisma.locker.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到置物櫃');
  res.json(await prisma.locker.update({ where: { id: own.id }, data: lockerSchema.partial().parse(req.body) }));
}
export async function deleteLocker(req: AuthRequest, res: Response) {
  const own = await prisma.locker.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到置物櫃');
  if (await prisma.lockerRental.count({ where: { lockerId: own.id } })) throw badRequest('這個置物櫃有租用紀錄，請改為停用');
  await prisma.locker.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 出租置物櫃：同一櫃同時只能有一位租用中 */
export async function rentLocker(req: AuthRequest, res: Response) {
  const d = z.object({ memberId: z.string(), startDate: day, months: z.coerce.number().int().min(1).max(36).optional(), endDate: day.optional(), price: z.coerce.number().int().min(0).optional(), payMethod: payMethod.optional(), note: z.string().max(200).optional() }).parse(req.body);
  const locker = await prisma.locker.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!locker) throw notFound('找不到置物櫃');
  if (!locker.active) throw badRequest('置物櫃已停用');
  if (!(await prisma.member.findFirst({ where: { id: d.memberId, userId: req.userId! } }))) throw notFound('找不到會員');
  if (await prisma.lockerRental.count({ where: { lockerId: locker.id, status: 'ACTIVE' } })) throw badRequest('這個置物櫃已有人租用');
  const months = d.months ?? 1;
  const [y, m, dd] = d.startDate.split('-').map(Number);
  const end = d.endDate ?? addDays(new Date(Date.UTC(y, m - 1 + months, dd)).toISOString().slice(0, 10), -1);
  if (end < d.startDate) throw badRequest('結束日不能早於開始日');
  res.status(201).json(await prisma.lockerRental.create({
    data: { userId: req.userId!, lockerId: locker.id, memberId: d.memberId, startDate: dateOnly(d.startDate), endDate: dateOnly(end), price: d.price ?? locker.monthlyRate * months, payMethod: d.payMethod ?? 'CASH', note: d.note },
  }));
}
/** 續租（延長到期日並記一筆收入）或退租 */
export async function updateLockerRental(req: AuthRequest, res: Response) {
  const own = await prisma.lockerRental.findFirst({ where: { id: req.params.id, userId: req.userId! }, include: { locker: true } });
  if (!own) throw notFound('找不到租用紀錄');
  const d = z.object({ action: z.enum(['extend', 'end']), months: z.coerce.number().int().min(1).max(36).optional(), price: z.coerce.number().int().min(0).optional(), payMethod: payMethod.optional() }).parse(req.body);
  if (own.status !== 'ACTIVE') throw badRequest('這筆租用已結束');
  if (d.action === 'end') { res.json(await prisma.lockerRental.update({ where: { id: own.id }, data: { status: 'ENDED' } })); return; }
  // 續租另記一筆（營收以每筆租用的金額與建立時間計算），原租用結束
  const months = d.months ?? 1;
  const start = addDays(dateOnlyStr(own.endDate), 1);
  const [y, m, dd] = start.split('-').map(Number);
  const end = addDays(new Date(Date.UTC(y, m - 1 + months, dd)).toISOString().slice(0, 10), -1);
  const [, next] = await prisma.$transaction([
    prisma.lockerRental.update({ where: { id: own.id }, data: { status: 'ENDED' } }),
    prisma.lockerRental.create({ data: { userId: req.userId!, lockerId: own.lockerId, memberId: own.memberId, startDate: dateOnly(start), endDate: dateOnly(end), price: d.price ?? own.locker.monthlyRate * months, payMethod: d.payMethod ?? own.payMethod, note: '續租' } }),
  ]);
  res.json(next);
}

/* ---------- 體組成 ---------- */

const metricSchema = z.object({
  measuredAt: day,
  heightCm: z.coerce.number().min(50).max(250).nullable().optional(),
  weightKg: z.coerce.number().min(10).max(400).nullable().optional(),
  bodyFatPct: z.coerce.number().min(1).max(80).nullable().optional(),
  muscleKg: z.coerce.number().min(1).max(200).nullable().optional(),
  visceralFat: z.coerce.number().min(0).max(60).nullable().optional(),
  bmr: z.coerce.number().int().min(300).max(6000).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});
const withBmi = <T extends { heightCm: number | null; weightKg: number | null }>(m: T) => ({
  ...m, bmi: m.heightCm && m.weightKg ? Math.round((m.weightKg / (m.heightCm / 100) ** 2) * 10) / 10 : null,
});

export async function listMetrics(req: AuthRequest, res: Response) {
  const member = await prisma.member.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!member) throw notFound('找不到會員');
  res.json((await prisma.bodyMetric.findMany({ where: { memberId: member.id }, orderBy: { measuredAt: 'desc' } })).map(withBmi));
}
export async function createMetric(req: AuthRequest, res: Response) {
  const member = await prisma.member.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!member) throw notFound('找不到會員');
  const d = metricSchema.parse(req.body);
  res.status(201).json(withBmi(await prisma.bodyMetric.create({ data: { ...d, measuredAt: dateOnly(d.measuredAt), userId: req.userId!, memberId: member.id } })));
}
export async function deleteMetric(req: AuthRequest, res: Response) {
  const own = await prisma.bodyMetric.findFirst({ where: { id: req.params.metricId, userId: req.userId! } });
  if (!own) throw notFound('找不到紀錄');
  await prisma.bodyMetric.delete({ where: { id: own.id } });
  res.json({ ok: true });
}
export async function portalMetrics(req: MemberRequest, res: Response) {
  res.json((await prisma.bodyMetric.findMany({ where: { memberId: req.memberId! }, orderBy: { measuredAt: 'desc' }, take: 50 })).map(withBmi));
}
