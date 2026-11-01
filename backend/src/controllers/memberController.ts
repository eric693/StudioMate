// 會員資料、售卡、凍結、LINE 綁定碼
import crypto from 'crypto';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { freezeMembership, sellMembership, unfreezeMembership } from '../services/membershipService';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');

const memberSchema = z.object({
  name: z.string().trim().min(1, '請填寫姓名').max(40),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, '電話格式不正確'),
  email: z.string().trim().email('Email 格式不正確').optional().nullable().or(z.literal('').transform(() => null)),
  birthday: day.optional().nullable().or(z.literal('').transform(() => null)),
  emergencyContact: z.string().trim().max(80).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// 生日字串轉成資料庫的日期；保留呼叫端原本的型別（新增時欄位必填、修改時可部分更新）
function toData<T extends { birthday?: string | null }>(d: T): Omit<T, 'birthday'> & { birthday?: Date | null } {
  const { birthday, ...rest } = d;
  return birthday === undefined ? rest : { ...rest, birthday: birthday ? dateOnly(birthday) : null };
}

/** 會員列表：附目前有效方案的摘要（剩餘堂數、最晚到期日），可依姓名或電話搜尋 */
export async function listMembers(req: AuthRequest, res: Response) {
  const q = String(req.query.q ?? '').trim();
  const studio = await getStudio(req.userId!);
  const today = dateOnly(localDate(new Date(), studio.timezone));
  const members = await prisma.member.findMany({
    where: {
      userId: req.userId!,
      ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
      ...(req.query.status ? { status: req.query.status as 'ACTIVE' | 'INACTIVE' } : {}),
    },
    include: { memberships: { where: { status: { in: ['ACTIVE', 'FROZEN'] }, endDate: { gte: today } }, orderBy: { endDate: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(members.map(({ memberships, lineBindingCode: _c, ...m }) => ({
    ...m,
    lineBound: Boolean(m.lineUserId),
    activePasses: memberships.map((x) => ({ id: x.id, planName: x.planName, kind: x.kind, creditsLeft: x.creditsLeft, endDate: x.endDate, status: x.status })),
  })));
}

export async function getMember(req: AuthRequest, res: Response) {
  const member = await prisma.member.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      memberships: { orderBy: { createdAt: 'desc' } },
      bookings: { include: { session: { include: { classType: true, coach: true } } }, orderBy: { session: { startsAt: 'desc' } }, take: 100 },
    },
  });
  if (!member) throw notFound('找不到會員');
  const { lineBindingCode: _c, ...rest } = member;
  res.json({ ...rest, lineBound: Boolean(member.lineUserId) });
}

export async function createMember(req: AuthRequest, res: Response) {
  const data = memberSchema.parse(req.body);
  try {
    res.status(201).json(await prisma.member.create({ data: { ...toData(data), userId: req.userId! } }));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw badRequest('這支電話已經有會員使用');
    throw e;
  }
}

export async function updateMember(req: AuthRequest, res: Response) {
  const own = await prisma.member.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到會員');
  try {
    res.json(await prisma.member.update({ where: { id: own.id }, data: toData(memberSchema.partial().parse(req.body)) }));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw badRequest('這支電話已經有會員使用');
    throw e;
  }
}

export async function deleteMember(req: AuthRequest, res: Response) {
  const own = await prisma.member.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到會員');
  if (await prisma.membership.count({ where: { memberId: own.id } })) throw badRequest('這位會員有購買紀錄，請改為「停用」以保留營收資料');
  await prisma.member.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 產生 LINE 綁定碼（會員在 LINE 官方帳號輸入，或在會員網頁用來登入），24 小時有效 */
export async function createBindingCode(req: AuthRequest, res: Response) {
  const own = await prisma.member.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到會員');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 0/O、1/I/L
  for (let i = 0; i < 5; i++) {
    const code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
    try {
      await prisma.member.update({ where: { id: own.id }, data: { lineBindingCode: code, lineBindingCodeExpiry: new Date(Date.now() + 24 * 3600e3) } });
      res.json({ code, expiresAt: new Date(Date.now() + 24 * 3600e3) });
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  throw new Error('無法產生綁定碼');
}

export async function unbindLine(req: AuthRequest, res: Response) {
  const own = await prisma.member.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到會員');
  await prisma.member.update({ where: { id: own.id }, data: { lineUserId: null, lineDisplayName: null, lineBoundAt: null } });
  res.json({ ok: true });
}

/* ---------- 方案（售卡） ---------- */

const sellSchema = z.object({
  memberId: z.string(),
  planId: z.string(),
  startDate: day.optional(),
  price: z.coerce.number().int().min(0).max(10_000_000).optional(),
  payMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']).optional(),
  note: z.string().max(500).optional(),
});

export async function sell(req: AuthRequest, res: Response) {
  res.status(201).json(await sellMembership(req.userId!, sellSchema.parse(req.body)));
}

export async function freeze(req: AuthRequest, res: Response) {
  const { from, until } = z.object({ from: day, until: day }).parse(req.body);
  res.json(await freezeMembership(req.userId!, req.params.id, from, until));
}

export async function unfreeze(req: AuthRequest, res: Response) {
  res.json(await unfreezeMembership(req.userId!, req.params.id));
}

/** 銷售紀錄：可依會員姓名／電話／方案名稱搜尋，依狀態、類型、付款方式、售出期間篩選 */
export async function listMemberships(req: AuthRequest, res: Response) {
  const f = z.object({
    q: z.string().trim().optional(),
    status: z.enum(['ACTIVE', 'FROZEN', 'EXPIRED', 'CANCELLED']).optional(),
    kind: z.enum(['PACK', 'PERIOD', 'DROPIN']).optional(),
    payMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']).optional(),
    from: day.optional(),
    to: day.optional(),
  }).parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  const studio = await getStudio(req.userId!);
  const list = await prisma.membership.findMany({
    where: {
      userId: req.userId!,
      ...(f.status ? { status: f.status } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.payMethod ? { payMethod: f.payMethod } : {}),
      ...(f.from || f.to ? { paidAt: {
        ...(f.from ? { gte: localToUtc(f.from, '00:00', studio.timezone) } : {}),
        ...(f.to ? { lt: localToUtc(addDays(f.to, 1), '00:00', studio.timezone) } : {}),
      } } : {}),
      ...(f.q ? { OR: [
        { planName: { contains: f.q, mode: 'insensitive' as const } },
        { member: { name: { contains: f.q, mode: 'insensitive' as const } } },
        { member: { phone: { contains: f.q } } },
      ] } : {}),
    },
    include: { member: { select: { id: true, name: true, phone: true } }, _count: { select: { bookings: true } } },
    orderBy: { paidAt: 'desc' },
    take: 500,
  });
  res.json(list.map(({ _count, ...m }) => ({ ...m, bookingCount: _count.bookings })));
}

/** 刪除售卡紀錄：只限輸入錯誤、還沒用來預約的方案；已使用過的請改「作廢」保留紀錄 */
export async function deleteMembership(req: AuthRequest, res: Response) {
  const own = await prisma.membership.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到方案');
  if (await prisma.booking.count({ where: { membershipId: own.id } })) throw badRequest('這張方案已經用來預約過，請改用「作廢」保留紀錄');
  await prisma.membership.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 調整方案（補堂、延期、修改金額／付款方式／備註）或作廢 */
export async function updateMembership(req: AuthRequest, res: Response) {
  const own = await prisma.membership.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到方案');
  const d = z.object({
    creditsLeft: z.coerce.number().int().min(0).max(1000).optional(),
    endDate: day.optional(),
    note: z.string().max(500).optional().nullable(),
    status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
    price: z.coerce.number().int().min(0).max(10_000_000).optional(),
    payMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']).optional(),
  }).parse(req.body);
  if (d.creditsLeft !== undefined && own.kind === 'PERIOD') throw badRequest('期限卡沒有堂數');
  res.json(await prisma.membership.update({
    where: { id: own.id },
    data: { ...d, ...(d.endDate ? { endDate: dateOnly(d.endDate) } : {}) },
  }));
}
