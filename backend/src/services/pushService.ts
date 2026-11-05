// 手機推播（Web Push）：會員把會員網頁加到主畫面並允許通知後，系統通知除了 LINE 也會推到手機。
// 未設定 VAPID 金鑰時停用。訂閱失效（410/404）會自動刪除。
import webpush from 'web-push';
import { prisma } from '../app';
import { config } from '../config';

let ready = false;
function init() {
  if (ready) return true;
  if (!config.push.enabled) return false;
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
  ready = true;
  return true;
}

export const pushEnabled = () => config.push.enabled;

/** 推播給會員所有裝置，回傳成功送出的裝置數 */
export async function pushToMember(memberId: string, title: string, body: string, url = '/m') {
  if (!init()) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { memberId } });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body: body.slice(0, 500), url }),
        { TTL: 24 * 3600, timeout: 10000 },
      );
      sent++;
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      else console.error('[push]', status ?? '', (e as Error).message);
    }
  }
  return sent;
}

/** 通知文字第一行「【教室】標題」拆成推播標題與內容 */
export function splitMessage(text: string, fallbackTitle: string) {
  const [first, ...rest] = text.split('\n');
  const m = /^【(.+?)】(.*)$/.exec(first);
  if (m && rest.length) return { title: m[2] ? `${m[1]}・${m[2]}` : m[1], body: rest.join('\n') };
  return { title: fallbackTitle, body: text };
}
