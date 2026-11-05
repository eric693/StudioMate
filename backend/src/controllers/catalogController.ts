import { Prisma } from '@prisma/client';
// 方案、課程類型、教練的維護（皆以教室擁有者 userId 為範圍）
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { badRequest, notFound } from '../utils/http';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '顏色格式須為 #RRGGBB');

const classTypeSchema = z.object({
  name: z.string().trim().min(1, '請填寫課程名稱').max(40),
  color: color.optional(),
  durationMin: z.coerce.number().int().min(10).max(600).optional(),
  defaultCapacity: z.coerce.number().int().min(1).max(500).optional(),
  creditCost: z.coerce.number().int().min(0).max(20).optional(),
  isPrivate: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function listClassTypes(req: AuthRequest, res: Response) {
  res.json(await prisma.classType.findMany({ where: { userId: req.userId! }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
}
export async function createClassType(req: AuthRequest, res: Response) {
  res.status(201).json(await prisma.classType.create({ data: { ...classTypeSchema.parse(req.body), userId: req.userId! } }));
}
export async function updateClassType(req: AuthRequest, res: Response) {
  const own = await prisma.classType.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound();
  res.json(await prisma.classType.update({ where: { id: own.id }, data: classTypeSchema.partial().parse(req.body) }));
}
export async function deleteClassType(req: AuthRequest, res: Response) {
  const own = await prisma.classType.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound();
  const used = await prisma.classSession.count({ where: { classTypeId: own.id } }) + await prisma.scheduleTemplate.count({ where: { classTypeId: own.id } });
  if (used) throw badRequest('這個課程類型已經有課表或課程，請改為「停用」');
  await prisma.classType.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

const coachSchema = z.object({
  name: z.string().trim().min(1, '請填寫教練姓名').max(40),
  phone: z.string().trim().max(30).optional().nullable(),
  color: color.optional(),
  payPerClass: z.coerce.number().int().min(0).max(100000).optional(),
  payPerHead: z.coerce.number().int().min(0).max(100000).optional(),
  headThreshold: z.coerce.number().int().min(0).max(500).optional(),
  revenueShare: z.coerce.number().int().min(0).max(100).optional(),
  // 階梯式抽成：當月產值達到門檻後套用對應 %
  shareTiers: z.array(z.object({ min: z.coerce.number().int().min(0).max(100_000_000), rate: z.coerce.number().int().min(0).max(100) }))
    .max(10).nullable().optional().transform((t) => (t && t.length ? [...t].sort((a, b) => a.min - b.min) : t === undefined ? undefined : Prisma.DbNull)),
  active: z.boolean().optional(),
});

export async function listCoaches(req: AuthRequest, res: Response) {
  res.json(await prisma.coach.findMany({
    where: { userId: req.userId! }, orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { availability: true } } },
  }));
}
export async function createCoach(req: AuthRequest, res: Response) {
  res.status(201).json(await prisma.coach.create({ data: { ...coachSchema.parse(req.body), userId: req.userId! } }));
}
export async function updateCoach(req: AuthRequest, res: Response) {
  const own = await prisma.coach.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound();
  res.json(await prisma.coach.update({ where: { id: own.id }, data: coachSchema.partial().parse(req.body) }));
}
export async function deleteCoach(req: AuthRequest, res: Response) {
  const own = await prisma.coach.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound();
  // 刪除後課表與課程保留，教練欄位改為空白（資料表設定為 SetNull）
  await prisma.coach.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

const planSchema = z.object({
  name: z.string().trim().min(1, '請填寫方案名稱').max(60),
  kind: z.enum(['PACK', 'PERIOD', 'DROPIN']),
  credits: z.coerce.number().int().min(1).max(1000).optional().nullable(),
  validDays: z.coerce.number().int().min(1).max(3650),
  price: z.coerce.number().int().min(0).max(10_000_000),
  classTypeIds: z.array(z.string()).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(20).optional().nullable(),
  onlineSale: z.boolean().optional(),
  trialOnly: z.boolean().optional(),
  recurring: z.boolean().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
}).superRefine((p, ctx) => {
  if (p.kind === 'PACK' && !p.credits) ctx.addIssue({ code: 'custom', path: ['credits'], message: '堂數卡須填寫堂數' });
  if (p.recurring && p.kind !== 'PERIOD') ctx.addIssue({ code: 'custom', path: ['recurring'], message: '定期定額只適用期限卡（例如月卡）' });
});

async function checkClassTypes(userId: string, ids?: string[]) {
  if (!ids?.length) return;
  const n = await prisma.classType.count({ where: { userId, id: { in: ids } } });
  if (n !== new Set(ids).size) throw badRequest('包含不存在的課程類型');
}

export async function listPlans(req: AuthRequest, res: Response) {
  res.json(await prisma.plan.findMany({ where: { userId: req.userId! }, orderBy: [{ active: 'desc' }, { price: 'asc' }] }));
}
export async function createPlan(req: AuthRequest, res: Response) {
  const data = planSchema.parse(req.body);
  await checkClassTypes(req.userId!, data.classTypeIds);
  if (data.kind === 'DROPIN') data.credits = 1;
  if (data.kind === 'PERIOD') data.credits = null;
  res.status(201).json(await prisma.plan.create({ data: { ...data, userId: req.userId! } }));
}
export async function updatePlan(req: AuthRequest, res: Response) {
  const own = await prisma.plan.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound();
  const data = planSchema.parse({ ...own, ...req.body });
  await checkClassTypes(req.userId!, data.classTypeIds);
  if (data.kind === 'DROPIN') data.credits = 1;
  if (data.kind === 'PERIOD') data.credits = null;
  // 已售出的方案在購買時已複製內容，修改方案只影響之後的銷售
  res.json(await prisma.plan.update({ where: { id: own.id }, data }));
}
export async function deletePlan(req: AuthRequest, res: Response) {
  const own = await prisma.plan.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound();
  if (await prisma.membership.count({ where: { planId: own.id } })) throw badRequest('這個方案已經有人購買，請改為「停售」');
  await prisma.plan.delete({ where: { id: own.id } });
  res.json({ ok: true });
}
