// LINE webhook：會員在官方帳號輸入綁定碼完成綁定。未設定 LINE 憑證時回 200 但不處理
import { Request, Response } from 'express';
import { prisma } from '../app';
import { config } from '../config';
import { reply, verifySignature } from '../services/lineService';

interface LineEvent { type: string; replyToken?: string; source?: { userId?: string }; message?: { type: string; text?: string } }

export async function webhook(req: Request & { rawBody?: string }, res: Response) {
  if (!config.line.enabled) { res.json({ ok: true, sandbox: true }); return; }
  const signature = req.get('x-line-signature') ?? '';
  if (!req.rawBody || !verifySignature(req.rawBody, signature)) { res.status(401).json({ error: 'invalid signature' }); return; }
  res.json({ ok: true }); // 先回應 LINE，避免逾時重送
  const events = (req.body?.events ?? []) as LineEvent[];
  for (const ev of events) {
    try {
      const lineUserId = ev.source?.userId;
      if (!lineUserId || !ev.replyToken) continue;
      if (ev.type === 'follow') {
        await reply(ev.replyToken, '歡迎加入！請輸入教室提供的 6 碼綁定碼，完成會員綁定後就能收到上課提醒。');
        continue;
      }
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const code = (ev.message.text ?? '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) continue;
      const member = await prisma.member.findFirst({ where: { lineBindingCode: code, lineBindingCodeExpiry: { gt: new Date() } }, include: { user: { select: { studio: { select: { name: true } } } } } });
      if (!member) { await reply(ev.replyToken, '綁定碼無效或已過期，請向教室索取新的綁定碼。'); continue; }
      await prisma.member.update({ where: { id: member.id }, data: { lineUserId, lineBoundAt: new Date(), lineBindingCode: null, lineBindingCodeExpiry: null } });
      await reply(ev.replyToken, `綁定成功！${member.name} 您好，之後會在這裡收到${member.user.studio?.name ?? '教室'}的上課提醒與通知。`);
    } catch (e) {
      console.error('LINE webhook event error', e);
    }
  }
}
