// 綠界（ECPay）：全方位金流（信用卡／ATM）與 B2C 電子發票。
// 每間教室可設定自己的特店帳號；沒填時使用綠界公開的測試帳號（只能在測試環境使用，不會真的扣款或開立）。
import crypto from 'crypto';
import { Studio } from '@prisma/client';

// 綠界官方文件公開的測試特店
const STAGE_PAY = { merchantId: '3002607', hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };
const STAGE_INVOICE = { merchantId: '2000132', hashKey: 'ejCk326UnaZWKisg', hashIV: 'q9jcZX8Ib9LM8wYk' };

export interface EcpayCreds { merchantId: string; hashKey: string; hashIV: string; production: boolean }

export function payCreds(s: Studio): EcpayCreds {
  const production = s.ecpayMode === 'production';
  if (production && s.ecpayMerchantId && s.ecpayHashKey && s.ecpayHashIV) {
    return { merchantId: s.ecpayMerchantId, hashKey: s.ecpayHashKey, hashIV: s.ecpayHashIV, production };
  }
  return { ...STAGE_PAY, production: false };
}

export function invoiceCreds(s: Studio): EcpayCreds {
  const production = s.invoiceMode === 'production';
  if (production && s.invoiceMerchantId && s.invoiceHashKey && s.invoiceHashIV) {
    return { merchantId: s.invoiceMerchantId, hashKey: s.invoiceHashKey, hashIV: s.invoiceHashIV, production };
  }
  return { ...STAGE_INVOICE, production: false };
}

/* ---------- 金流 ---------- */

/** CheckMacValue：參數依名稱排序 → 前後加 HashKey/HashIV → .NET 風格 URL encode → 小寫 → SHA256 → 大寫 */
export function checkMac(params: Record<string, string>, c: Pick<EcpayCreds, 'hashKey' | 'hashIV'>) {
  const qs = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const encoded = encodeURIComponent(`HashKey=${c.hashKey}&${qs}&HashIV=${c.hashIV}`)
    .toLowerCase()
    .replace(/%20/g, '+')
    .replace(/%2d/g, '-').replace(/%5f/g, '_').replace(/%2e/g, '.').replace(/%21/g, '!')
    .replace(/%2a/g, '*').replace(/%28/g, '(').replace(/%29/g, ')')
    .replace(/'/g, '%27').replace(/~/g, '%7e');
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

export function verifyMac(params: Record<string, string>, c: EcpayCreds) {
  const given = params.CheckMacValue ?? '';
  const expected = checkMac(params, c);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** 綠界要求的「yyyy/MM/dd HH:mm:ss」台灣時間 */
function tradeDate(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** 產生導向綠界付款頁的表單（前端自動送出） */
export interface CheckoutOptions {
  tradeNo: string; amount: number; itemName: string; notifyUrl: string; backUrl: string;
  /** 信用卡分期期數，例如 "3,6,12"（會員在綠界頁面選擇） */
  installments?: string | null;
  /** 定期定額：每月扣款 execTimes 期，之後每期結果通知 periodUrl */
  period?: { execTimes: number; periodUrl: string } | null;
}

export function buildCheckout(c: EcpayCreds, o: CheckoutOptions) {
  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    MerchantTradeNo: o.tradeNo,
    MerchantTradeDate: tradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(o.amount),
    TradeDesc: 'StudioMate',
    ItemName: o.itemName.replace(/[#&]/g, ' ').slice(0, 200),
    ReturnURL: o.notifyUrl,
    ClientBackURL: o.backUrl,
    ChoosePayment: 'Credit',
    EncryptType: '1',
  };
  if (o.period) {
    // 定期定額：每 1 個月扣一次，共 execTimes 期（綠界月扣上限 99 期）
    Object.assign(fields, {
      PeriodAmount: String(o.amount), PeriodType: 'M', Frequency: '1',
      ExecTimes: String(Math.min(99, Math.max(2, o.period.execTimes))), PeriodReturnURL: o.period.periodUrl,
    });
  } else if (o.installments) {
    fields.CreditInstallment = o.installments;
  }
  fields.CheckMacValue = checkMac(fields, c);
  const action = c.production ? 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5' : 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
  return { action, fields };
}

/** 定期定額：停止之後的扣款（Action=Cancel） */
export async function cancelPeriod(c: EcpayCreds, tradeNo: string) {
  const fields: Record<string, string> = { MerchantID: c.merchantId, MerchantTradeNo: tradeNo, Action: 'Cancel', TimeStamp: String(Math.floor(Date.now() / 1000)) };
  fields.CheckMacValue = checkMac(fields, c);
  const host = c.production ? 'https://payment.ecpay.com.tw' : 'https://payment-stage.ecpay.com.tw';
  const r = await fetch(`${host}/Cashier/CreditCardPeriodAction`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  const p = Object.fromEntries(new URLSearchParams(text));
  if (p.RtnCode !== '1') throw new Error(p.RtnMsg || text.slice(0, 100) || '綠界停止扣款失敗');
}

/* ---------- 電子發票 ---------- */

const aesEncrypt = (data: object, c: EcpayCreds) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', c.hashKey, c.hashIV);
  return cipher.update(encodeURIComponent(JSON.stringify(data)), 'utf8', 'base64') + cipher.final('base64');
};
const aesDecrypt = (data: string, c: EcpayCreds) => {
  const d = crypto.createDecipheriv('aes-128-cbc', c.hashKey, c.hashIV);
  return JSON.parse(decodeURIComponent(d.update(data, 'base64', 'utf8') + d.final('utf8')));
};

async function invoiceCall(c: EcpayCreds, path: string, data: Record<string, unknown>) {
  const host = c.production ? 'https://einvoice.ecpay.com.tw' : 'https://einvoice-stage.ecpay.com.tw';
  const r = await fetch(host + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ MerchantID: c.merchantId, RqHeader: { Timestamp: Math.floor(Date.now() / 1000) }, Data: aesEncrypt({ MerchantID: c.merchantId, ...data }, c) }),
    signal: AbortSignal.timeout(20000),
  });
  const j = (await r.json()) as { TransCode: number; TransMsg: string; Data: string | null };
  if (j.TransCode !== 1 || !j.Data) throw new Error(`發票平台錯誤：${j.TransMsg}`);
  const d = aesDecrypt(j.Data, c) as { RtnCode: number; RtnMsg: string; InvoiceNo?: string; InvoiceDate?: string; RandomNumber?: string };
  if (d.RtnCode !== 1) throw new Error(d.RtnMsg);
  return d;
}

export interface InvoiceBuyer {
  name: string; email?: string | null; phone?: string | null;
  carrierType?: string | null; carrierNum?: string | null; taxId?: string | null; title?: string | null; loveCode?: string | null;
}

export interface InvoiceItem { name: string; price: number; qty: number; word?: string }

/** 開立 B2C 發票（含稅金額）。統編發票買方名稱用公司抬頭；捐贈用愛心碼。items 沒給時以 itemName 單一品項開立 */
export async function issueInvoice(c: EcpayCreds, o: { relateNumber: string; amount: number; itemName: string; buyer: InvoiceBuyer; items?: InvoiceItem[] }) {
  const b = o.buyer;
  const company = b.carrierType === 'COMPANY' && b.taxId;
  const donate = b.carrierType === 'DONATE';
  const carrier = company || donate ? '' : b.carrierType === 'MOBILE' ? '3' : b.carrierType === 'CITIZEN' ? '2' : '1';
  const d = await invoiceCall(c, '/B2CInvoice/Issue', {
    RelateNumber: o.relateNumber,
    CustomerID: '',
    CustomerIdentifier: company ? b.taxId : '',
    CustomerName: company ? (b.title || b.name) : b.name,
    CustomerAddr: '',
    CustomerPhone: b.email ? '' : (b.phone ?? ''),
    CustomerEmail: b.email ?? '',
    ClearanceMark: '',
    Print: company ? '1' : '0',
    Donation: donate ? '1' : '0',
    LoveCode: donate ? (b.loveCode || b.carrierNum || '') : '',
    CarrierType: carrier,
    CarrierNum: carrier === '2' || carrier === '3' ? (b.carrierNum ?? '') : '',
    TaxType: '1',
    SalesAmount: o.amount,
    InvoiceRemark: '',
    InvType: '07',
    vat: '1',
    Items: invoiceItems(o.amount, o.itemName, o.items),
  });
  return { invoiceNo: d.InvoiceNo!, invoiceDate: d.InvoiceDate!, random: d.RandomNumber ?? '' };
}

/** 發票品項：多品項時若有折扣，加一行負數「折扣」讓合計等於發票金額 */
function invoiceItems(amount: number, itemName: string, items?: InvoiceItem[]) {
  if (!items?.length) return [{ ItemSeq: 1, ItemName: itemName.slice(0, 100), ItemCount: 1, ItemWord: '份', ItemPrice: amount, ItemTaxType: '1', ItemAmount: amount }];
  const rows = items.map((it, i) => ({ ItemSeq: i + 1, ItemName: it.name.slice(0, 100), ItemCount: it.qty, ItemWord: it.word ?? '個', ItemPrice: it.price, ItemTaxType: '1', ItemAmount: it.price * it.qty }));
  const diff = amount - rows.reduce((a, r) => a + r.ItemAmount, 0);
  if (diff) rows.push({ ItemSeq: rows.length + 1, ItemName: '折扣', ItemCount: 1, ItemWord: '筆', ItemPrice: diff, ItemTaxType: '1', ItemAmount: diff });
  return rows;
}

/** 開立折讓（部分退費）：線上折讓，買方免簽回。回傳折讓單號 */
export async function allowanceInvoice(c: EcpayCreds, o: { invoiceNo: string; invoiceDate: Date; amount: number; itemName: string; email?: string | null }) {
  const day = new Date(o.invoiceDate.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  const d = await invoiceCall(c, '/B2CInvoice/Allowance', {
    InvoiceNo: o.invoiceNo, InvoiceDate: day, AllowanceNotify: o.email ? 'E' : 'N', CustomerName: '', NotifyMail: o.email ?? '', NotifyPhone: '',
    AllowanceAmount: o.amount,
    Items: [{ ItemSeq: 1, ItemName: `${o.itemName}退費`.slice(0, 100), ItemCount: 1, ItemWord: '份', ItemPrice: o.amount, ItemTaxType: '1', ItemAmount: o.amount }],
  }) as unknown as { IA_Allow_No?: string };
  return d.IA_Allow_No ?? '';
}

export async function voidInvoice(c: EcpayCreds, invoiceNo: string, invoiceDate: Date, reason: string) {
  const day = new Date(invoiceDate.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  await invoiceCall(c, '/B2CInvoice/Invalid', { InvoiceNo: invoiceNo, InvoiceDate: day, Reason: reason.slice(0, 20) || '作廢' });
}
