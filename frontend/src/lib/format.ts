// 顯示格式：時間一律以教室所在時區顯示（不受使用者裝置時區影響）
export const TZ_DEFAULT = 'Asia/Taipei';
let tz = TZ_DEFAULT;
export const setTimeZone = (z: string) => { tz = z || TZ_DEFAULT; };
export const getTimeZone = () => tz;

const parts = (d: Date | string) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(d));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), min: g('minute'), w: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
};
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 教室當地日期 YYYY-MM-DD */
export const localDay = (d: Date | string = new Date()) => { const p = parts(d); return `${p.y}-${p.m}-${p.d}`; };
export const hm = (d: Date | string) => { const p = parts(d); return `${p.h}:${p.min}`; };
export const weekdayOf = (d: Date | string) => parts(d).w;
/** 「11/4（二）19:00」 */
export const dateTime = (d: Date | string) => { const p = parts(d); return `${+p.m}/${+p.d}（${WEEKDAYS[p.w]}）${p.h}:${p.min}`; };
/** 「11/4（二）」：用於 YYYY-MM-DD 字串或日期 */
export function shortDay(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return `${m}/${d}（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}
export function addDays(s: string, n: number) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 這週週一（教室當地） */
export function weekStart(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(day, -((w + 6) % 7));
}
export const money = (n: number) => `NT$ ${n.toLocaleString('zh-TW')}`;
export const dateStr = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');

export const PLAN_KIND: Record<string, string> = { PACK: '堂數卡', PERIOD: '期限卡', DROPIN: '單堂' };
export const PASS_STATUS: Record<string, string> = { ACTIVE: '使用中', FROZEN: '凍結中', EXPIRED: '已到期', CANCELLED: '已作廢', REFUNDED: '已退費', TRANSFERRED: '已轉讓' };
export const BOOKING_STATUS: Record<string, { label: string; cls: string }> = {
  BOOKED: { label: '已預約', cls: 'bg-blue-50 text-blue-600' },
  WAITLIST: { label: '候補', cls: 'bg-amber-50 text-amber-600' },
  ATTENDED: { label: '出席', cls: 'bg-green-50 text-green-600' },
  NO_SHOW: { label: '未到', cls: 'bg-red-50 text-red-500' },
  CANCELLED: { label: '已取消', cls: 'bg-gray-100 text-gray-400' },
  LATE_CANCELLED: { label: '晚取消', cls: 'bg-orange-50 text-orange-600' },
};
export const PAY_METHOD: Record<string, string> = { CASH: '現金', TRANSFER: '轉帳', CARD: '刷卡', LINEPAY: 'LINE Pay', OTHER: '其他' };

/** 方案剩餘的簡短說明：「剩 7 堂・12/31 到期」 */
export function passText(p: { kind: string; creditsLeft: number | null; endDate: string; status?: string }) {
  const left = p.kind === 'PERIOD' ? '不限堂數' : `剩 ${p.creditsLeft ?? 0} 堂`;
  return `${left}・${dateStr(p.endDate)} 到期${p.status === 'FROZEN' ? '（凍結中）' : ''}`;
}

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待處理', cls: 'bg-amber-50 text-amber-600' },
  PAID: { label: '已付款', cls: 'bg-green-50 text-green-600' },
  REJECTED: { label: '已退回', cls: 'bg-red-50 text-red-500' },
  CANCELLED: { label: '已取消', cls: 'bg-gray-100 text-gray-400' },
  FAILED: { label: '付款失敗', cls: 'bg-red-50 text-red-500' },
};
export const INVOICE_STATUS: Record<string, string> = { ISSUED: '已開立', VOID: '已作廢', FAILED: '開立失敗' };
export const CARRIER: Record<string, string> = { '': '會員載具（Email 通知）', MOBILE: '手機條碼', CITIZEN: '自然人憑證', DONATE: '捐贈', COMPANY: '公司統編' };

/** 下載後端產生的 CSV（需要帶登入 token，所以用 axios 取檔再存） */
export async function downloadCsv(api: { get: (url: string, cfg: object) => Promise<{ data: Blob; headers: Record<string, string> }> }, url: string, params: object, fallbackName: string) {
  const r = await api.get(url, { params, responseType: 'blob' });
  const m = /filename\*=UTF-8''([^;]+)/.exec(r.headers['content-disposition'] ?? '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.data);
  a.download = m ? decodeURIComponent(m[1]) : fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const ORDER_METHOD: Record<string, string> = { ONLINE: '線上刷卡', TRANSFER: '銀行轉帳', LINEPAY: 'LINE Pay' };
export const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: '扣款中', cls: 'bg-green-50 text-green-600' },
  PAST_DUE: { label: '扣款失敗', cls: 'bg-red-50 text-red-500' },
  CANCELLED: { label: '已停止', cls: 'bg-gray-100 text-gray-400' },
  ENDED: { label: '期數已滿', cls: 'bg-gray-100 text-gray-500' },
};
export const TRUST_TYPE: Record<string, string> = { TRUST: '信託', GUARANTEE: '銀行履約保證' };
/** 「1.5 小時」 */
export const hours = (n: number) => `${Math.round(n * 10) / 10} 小時`;
