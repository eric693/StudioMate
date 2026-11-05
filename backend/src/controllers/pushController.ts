// 會員端手機通知訂閱
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { config } from '../config';
import { MemberRequest } from '../middleware/memberAuth';
import { badRequest } from '../utils/http';
import { pushToMember } from '../services/pushService';
import { getStudio } from '../services/studioService';

export async function pushConfig(req: MemberRequest, res: Response) {
  const count = await prisma.pushSubscription.count({ where: { memberId: req.memberId! } });
  res.json({ enabled: config.push.enabled, publicKey: config.push.enabled ? config.push.publicKey : null, devices: count });
}

const subSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});

/** 訂閱：同一個 endpoint（同一台裝置）只留一筆，換人登入時改綁到目前的會員 */
export async function pushSubscribe(req: MemberRequest, res: Response) {
  if (!config.push.enabled) throw badRequest('教室尚未開放手機通知');
  const d = subSchema.parse(req.body);
  const data = { memberId: req.memberId!, p256dh: d.keys.p256dh, auth: d.keys.auth, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200) };
  await prisma.pushSubscription.upsert({ where: { endpoint: d.endpoint }, update: data, create: { ...data, endpoint: d.endpoint } });
  res.status(201).json({ ok: true });
}

export async function pushUnsubscribe(req: MemberRequest, res: Response) {
  const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
  await prisma.pushSubscription.deleteMany({ where: { endpoint, memberId: req.memberId! } });
  res.json({ ok: true });
}

export async function pushTest(req: MemberRequest, res: Response) {
  const m = await prisma.member.findUniqueOrThrow({ where: { id: req.memberId! } });
  const studio = await getStudio(m.userId);
  const sent = await pushToMember(m.id, studio.name, '手機通知已開啟，上課提醒、候補遞補等訊息會推送到這支手機。');
  if (!sent) throw badRequest('送不出通知，請重新開啟手機通知');
  res.json({ sent });
}
