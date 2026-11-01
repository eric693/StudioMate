// 時間換算：課程以 UTC 存放；固定課表與日期（到期日、上課日）以教室當地時間表示。
// 用 Intl 計算時區偏移，不依賴伺服器所在時區，任何時區（含日光節約）都正確。

/** 某個 UTC 時間點在指定時區的年月日時分 */
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    year: +get('year'), month: +get('month'), day: +get('day'),
    hour: +get('hour'), minute: +get('minute'), second: +get('second'), weekday,
  };
}

/** 時區相對 UTC 的偏移（毫秒），在指定時間點計算 */
function offsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** 當地的「年-月-日 時:分」轉成 UTC 時間點 */
export function localToUtc(dateStr: string, time: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // 先用猜測值的偏移換算，再用結果的偏移修正一次，處理日光節約切換附近的時間
  let utc = guess - offsetMs(new Date(guess), timeZone);
  utc = guess - offsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

/** UTC 時間點在當地是哪一天（YYYY-MM-DD） */
export function localDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** YYYY-MM-DD 加減天數 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** YYYY-MM-DD 是星期幾（0＝週日） */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Prisma 的 @db.Date 欄位以 UTC 午夜表示日期 */
export const dateOnly = (dateStr: string) => new Date(`${dateStr}T00:00:00.000Z`);
export const dateOnlyStr = (d: Date) => d.toISOString().slice(0, 10);

/** 顯示用：當地時間的「M/D（週X）HH:MM」 */
export function formatLocal(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const w = '日一二三四五六'[p.weekday];
  return `${p.month}/${p.day}（${w}）${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** 當地時間的「HH:MM」 */
export function localTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
