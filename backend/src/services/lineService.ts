// LINE 訊息：未設定 LINE 憑證時為沙盒模式，訊息只記錄在 ReminderLog（後台可查看），不實際送出。
// 每則通知先寫入 ReminderLog「占位」（唯一鍵：類型＋對象＋會員）再送出，排程重跑也不會重複推播；送出失敗就移除占位，下次重試。
import * as line from '@line/bot-sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '../app';
import { config } from '../config';

let client: line.messagingApi.MessagingApiClient | null = null;
function getClient() {
  if (!config.line.enabled) return null;
  if (!client) client = new line.messagingApi.MessagingApiClient({ channelAccessToken: config.line.accessToken });
  return client;
}

export type NotifyKind = 'CLASS' | 'EXPIRY' | 'LOW_CREDIT' | 'PROMOTED' | 'SESSION_CANCELLED';

/** 通知會員。回傳 'sent' | 'sandbox' | 'skipped'（未綁定 LINE 或已通知過）| 'failed' */
export async function notifyMember(userId: string, memberId: string, kind: NotifyKind, refId: string, text: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, userId }, select: { lineUserId: true } });
  const cl = getClient();
  if (cl && !member?.lineUserId) return 'skipped' as const; // 正式模式下，沒綁定 LINE 的會員收不到
  let logId: string;
  try {
    const log = await prisma.reminderLog.create({ data: { userId, memberId, kind, refId, channel: cl ? 'LINE' : 'SANDBOX', message: text } });
    logId = log.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'skipped' as const;
    throw e;
  }
  if (!cl) return 'sandbox' as const;
  try {
    await cl.pushMessage({ to: member!.lineUserId!, messages: [{ type: 'text', text }] });
    return 'sent' as const;
  } catch (err) {
    console.error('LINE push error:', err);
    await prisma.reminderLog.delete({ where: { id: logId } }).catch(() => {});
    return 'failed' as const;
  }
}

/** 回覆 webhook 訊息（綁定結果等） */
export async function reply(replyToken: string, text: string) {
  const cl = getClient();
  if (!cl) return;
  await cl.replyMessage({ replyToken, messages: [{ type: 'text', text }] }).catch((e) => console.error('LINE reply error:', e));
}

export const verifySignature = (body: string, signature: string) =>
  config.line.enabled && line.validateSignature(body, config.line.channelSecret, signature);
