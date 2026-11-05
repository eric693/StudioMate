// LINE Pay 線上付款（v3 API）：Request 取得付款網址 → 會員在 LINE Pay 付款 → 導回 confirmUrl → 伺服器 Confirm 完成扣款。
// 每間教室使用自己的 Channel ID / Secret；沙盒模式連 sandbox-api-pay.line.me（不會真的扣款）。
import crypto from 'crypto';
import { Studio } from '@prisma/client';

export interface LinePayCreds { channelId: string; secret: string; production: boolean }

export function linePayCreds(s: Studio): LinePayCreds | null {
  if (!s.linePayChannelId || !s.linePaySecret) return null;
  return { channelId: s.linePayChannelId, secret: s.linePaySecret, production: s.linePayMode === 'production' };
}

const host = (c: LinePayCreds) => (c.production ? 'https://api-pay.line.me' : 'https://sandbox-api-pay.line.me');

/** 簽章：Base64(HMAC-SHA256(ChannelSecret, ChannelSecret + URI + 內容 + nonce)) */
export function linePaySignature(secret: string, uri: string, body: string, nonce: string) {
  return crypto.createHmac('sha256', secret).update(secret + uri + body + nonce).digest('base64');
}

async function call<T>(c: LinePayCreds, uri: string, payload: object): Promise<T> {
  const body = JSON.stringify(payload);
  const nonce = crypto.randomUUID();
  const r = await fetch(host(c) + uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LINE-ChannelId': c.channelId,
      'X-LINE-Authorization-Nonce': nonce,
      'X-LINE-Authorization': linePaySignature(c.secret, uri, body, nonce),
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  // transactionId 是 19 位數字，超過 JavaScript 數字精度，解析前先轉成字串
  const text = (await r.text()).replace(/"transactionId"\s*:\s*(\d+)/g, '"transactionId":"$1"');
  const j = JSON.parse(text) as { returnCode: string; returnMessage: string; info?: T };
  if (j.returnCode !== '0000') throw new Error(`LINE Pay：${j.returnMessage}（${j.returnCode}）`);
  return j.info as T;
}

/** 建立付款請求，回傳要導向的付款網址 */
export async function linePayRequest(c: LinePayCreds, o: { orderId: string; amount: number; name: string; confirmUrl: string; cancelUrl: string }) {
  const info = await call<{ paymentUrl: { web: string; app: string }; transactionId: number | string }>(c, '/v3/payments/request', {
    amount: o.amount, currency: 'TWD', orderId: o.orderId,
    packages: [{ id: 'pkg', amount: o.amount, products: [{ name: o.name.slice(0, 100), quantity: 1, price: o.amount }] }],
    redirectUrls: { confirmUrl: o.confirmUrl, cancelUrl: o.cancelUrl },
  });
  return { url: info.paymentUrl.web, transactionId: String(info.transactionId) };
}

/** 會員付款後確認扣款（金額必須與請求時相同） */
export async function linePayConfirm(c: LinePayCreds, transactionId: string, amount: number) {
  await call(c, `/v3/payments/${transactionId}/confirm`, { amount, currency: 'TWD' });
}

/** 退款（部分或全額） */
export async function linePayRefund(c: LinePayCreds, transactionId: string, amount: number) {
  await call(c, `/v3/payments/${transactionId}/refund`, { refundAmount: amount });
}
