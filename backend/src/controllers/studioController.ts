// 教室資料與營運規則
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { getStudio } from '../services/studioService';
import { config } from '../config';

const studioSchema = z.object({
  name: z.string().trim().min(1, '請填寫教室名稱').max(60),
  phone: z.string().trim().max(30).nullable(),
  address: z.string().trim().max(200).nullable(),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, '時區不正確'),
  bookingWindowDays: z.coerce.number().int().min(1).max(90),
  cancelDeadlineHours: z.coerce.number().int().min(0).max(168),
  lateCancelForfeit: z.boolean(),
  waitlistEnabled: z.boolean(),
  autoAttend: z.boolean(),
  remindBeforeHours: z.coerce.number().int().min(0).max(72),
  expiryRemindDays: z.coerce.number().int().min(0).max(60),
  lowCreditThreshold: z.coerce.number().int().min(0).max(50),
}).partial();

export async function getStudioSettings(req: AuthRequest, res: Response) {
  res.json({ ...(await getStudio(req.userId!)), lineEnabled: config.line.enabled });
}

export async function updateStudioSettings(req: AuthRequest, res: Response) {
  await getStudio(req.userId!);
  res.json(await prisma.studio.update({ where: { userId: req.userId! }, data: studioSchema.parse(req.body) }));
}

/** 最近的通知紀錄（沙盒模式下可以在這裡看到「會送出」的訊息） */
export async function listNotifications(req: AuthRequest, res: Response) {
  const f = z.object({ q: z.string().trim().optional(), kind: z.string().optional(), channel: z.enum(['LINE', 'SANDBOX']).optional() })
    .parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  const memberIds = f.q
    ? (await prisma.member.findMany({ where: { userId: req.userId!, OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { phone: { contains: f.q } }] }, select: { id: true } })).map((m) => m.id)
    : null;
  const logs = await prisma.reminderLog.findMany({
    where: {
      userId: req.userId!,
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.channel ? { channel: f.channel } : {}),
      ...(memberIds ? { OR: [{ memberId: { in: memberIds } }, { message: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    orderBy: { createdAt: 'desc' }, take: 200,
  });
  const names = await prisma.member.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.memberId))] } }, select: { id: true, name: true } });
  const byId = Object.fromEntries(names.map((n) => [n.id, n.name]));
  res.json(logs.map((l) => ({ ...l, memberName: byId[l.memberId] ?? '（已刪除）' })));
}
