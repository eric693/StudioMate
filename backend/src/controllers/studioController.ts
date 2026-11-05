// 教室資料與營運規則
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { Studio } from '@prisma/client';
import { getStudio } from '../services/studioService';
import { badRequest } from '../utils/http';
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
  noShowLimit: z.coerce.number().int().min(0).max(20),
  noShowWindowDays: z.coerce.number().int().min(1).max(365),
  noShowSuspendDays: z.coerce.number().int().min(1).max(90),
  lateCancelCountsAsNoShow: z.boolean(),
  selfCheckIn: z.boolean(),
  checkInBeforeMin: z.coerce.number().int().min(0).max(180),
  onlinePayEnabled: z.boolean(),
  transferEnabled: z.boolean(),
  bankInfo: z.string().trim().max(500).nullable(),
  ecpayMode: z.enum(['stage', 'production']),
  ecpayMerchantId: z.string().trim().max(20).nullable(),
  ecpayHashKey: z.string().trim().max(64).nullable(),
  ecpayHashIV: z.string().trim().max(64).nullable(),
  invoiceEnabled: z.boolean(),
  invoiceMode: z.enum(['stage', 'production']),
  invoiceMerchantId: z.string().trim().max(20).nullable(),
  invoiceHashKey: z.string().trim().max(64).nullable(),
  invoiceHashIV: z.string().trim().max(64).nullable(),
  referralRewardAmount: z.coerce.number().int().min(0).max(100000),
  refundFeePercent: z.coerce.number().int().min(0).max(100),
  transferFee: z.coerce.number().int().min(0).max(100000),
  trustType: z.enum(['TRUST', 'GUARANTEE']).nullable().or(z.literal('').transform(() => null)),
  trustBank: z.string().trim().max(60).nullable(),
  trustNote: z.string().trim().max(300).nullable(),
  installments: z.string().trim().regex(/^(3|6|12|18|24|30)(,(3|6|12|18|24|30))*$/, '分期期數只能是 3、6、12、18、24、30，以逗號分隔').nullable().or(z.literal('').transform(() => null)),
  installmentMin: z.coerce.number().int().min(0).max(10_000_000),
  linePayEnabled: z.boolean(),
  linePayMode: z.enum(['sandbox', 'production']),
  linePayChannelId: z.string().trim().max(20).nullable(),
  linePaySecret: z.string().trim().max(64).nullable(),
  contractEnabled: z.boolean(),
  contractText: z.string().max(20000).nullable(),
  birthdayEnabled: z.boolean(),
  birthdayMessage: z.string().trim().max(500).nullable(),
  birthdayCoupon: z.coerce.number().int().min(0).max(100000),
  winbackEnabled: z.boolean(),
  winbackDays: z.coerce.number().int().min(7).max(365),
  winbackMessage: z.string().trim().max(500).nullable(),
  winbackCoupon: z.coerce.number().int().min(0).max(100000),
  accessAutoCheckIn: z.boolean(),
}).partial();

const SECRETS = ['ecpayHashKey', 'ecpayHashIV', 'invoiceHashKey', 'invoiceHashIV', 'linePaySecret'] as const;

/** 金鑰不回傳原文，只告訴前端有沒有設定；簽到 token 只給設定頁顯示 QR code 用 */
function publicStudio(s: Studio) {
  const out: Record<string, unknown> = { ...s, lineEnabled: config.line.enabled };
  for (const k of SECRETS) { out[`${k}Set`] = Boolean(s[k]); delete out[k]; }
  delete out.accessSecret;
  return out;
}

export async function getStudioSettings(req: AuthRequest, res: Response) {
  res.json(publicStudio(await getStudio(req.userId!)));
}

export async function updateStudioSettings(req: AuthRequest, res: Response) {
  await getStudio(req.userId!);
  const d = studioSchema.parse(req.body);
  // 金鑰欄位留空代表「不修改」，避免前端沒拿到原文時把金鑰清掉
  for (const k of SECRETS) if (!d[k]) delete d[k];
  if (d.ecpayMode === 'production' || d.invoiceMode === 'production') {
    const cur = await getStudio(req.userId!);
    const merged = { ...cur, ...d };
    if (merged.ecpayMode === 'production' && !(merged.ecpayMerchantId && merged.ecpayHashKey && merged.ecpayHashIV)) throw badRequest('切換正式金流前，請填寫綠界特店編號、HashKey 與 HashIV');
    if (merged.invoiceMode === 'production' && !(merged.invoiceMerchantId && merged.invoiceHashKey && merged.invoiceHashIV)) throw badRequest('切換正式發票前，請填寫綠界發票的特店編號、HashKey 與 HashIV');
  }
  if (d.linePayEnabled) {
    const merged = { ...(await getStudio(req.userId!)), ...d };
    if (!(merged.linePayChannelId && merged.linePaySecret)) throw badRequest('開啟 LINE Pay 前，請填寫 Channel ID 與 Channel Secret Key');
  }
  res.json(publicStudio(await prisma.studio.update({ where: { userId: req.userId! }, data: d })));
}

/** 發布新版會員條款：版本號加一，所有會員下次預約或購買前需重新同意 */
export async function publishTerms(req: AuthRequest, res: Response) {
  const { terms } = z.object({ terms: z.string().trim().max(20000) }).parse(req.body);
  const cur = await getStudio(req.userId!);
  res.json(publicStudio(await prisma.studio.update({
    where: { userId: req.userId! },
    data: terms ? { terms, termsVersion: cur.termsVersion + 1 } : { terms: null },
  })));
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
