// 第二版功能整合測試：線上購買（綠界／轉帳）、折價券、轉介紹、未到違規、會員條款、自助簽到、
// 私人課、直播、行事曆、教練薪資、分店與場地租借、匯入匯出、群發、電子發票（綠界測試環境）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
if (!process.env.TEST_DATABASE_URL) throw new Error('缺少 TEST_DATABASE_URL');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DISABLE_SCHEDULER = 'true';
process.env.ALLOW_REGISTER = 'true';
execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd: ROOT, env: process.env, stdio: 'ignore' });

const { default: app, prisma } = require('../dist/app.js');
const { checkMac } = require('../dist/services/ecpay.js');

let server, base;
const H = 3600e3, D = 86400e3;
async function call(method, url, body, token) {
  const r = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const ok = async (p) => { const r = await p; assert.ok(r.status < 300, `預期成功，實際 ${r.status}：${JSON.stringify(r.data)}`); return r.data; };
/** 下載 CSV：確認開頭有 UTF-8 BOM（Excel 才能正確顯示中文），回傳去掉 BOM 的文字 */
async function csv(url, token) {
  const res = await fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, url);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${url} 缺少 BOM`);
  return buf.subarray(3).toString('utf8');
}
const fail = async (p, status = 400) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

let T, T2, userId, ct, pack, coach;
const taipeiDay = (offsetDays = 0) => new Date(Date.now() + 8 * H + offsetDays * D).toISOString().slice(0, 10);

async function newMember(name, phone) { return ok(call('POST', '/api/members', { name, phone }, T)); }
async function portalToken(memberId) {
  const { code } = await ok(call('POST', `/api/members/${memberId}/binding-code`, {}, T));
  return (await ok(call('POST', '/api/portal/login', { bindingCode: code }))).token;
}
async function session(startsInMs, extra = {}) {
  const startsAt = new Date(Date.now() + startsInMs);
  return prisma.classSession.create({ data: { userId, classTypeId: ct.id, startsAt, endsAt: new Date(startsAt.getTime() + H), capacity: 5, ...extra } });
}

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  T = (await ok(call('POST', '/api/auth/register', { email: 'v2studio', password: 'pw-123456', name: '第二版教室' }))).token;
  T2 = (await ok(call('POST', '/api/auth/register', { email: 'v2other', password: 'pw-123456', name: '別間教室' }))).token;
  userId = (await ok(call('GET', '/api/auth/me', null, T))).id;
  ct = await ok(call('POST', '/api/class-types', { name: '流動瑜珈', defaultCapacity: 5 }, T));
  pack = await ok(call('POST', '/api/plans', { name: '10 堂卡', kind: 'PACK', credits: 10, validDays: 90, price: 4000, onlineSale: true }, T));
  coach = await ok(call('POST', '/api/coaches', { name: '小芸', payPerClass: 800, payPerHead: 100, headThreshold: 2, revenueShare: 10 }, T));
});
after(async () => { server?.close(); await prisma.$disconnect(); });

test('折價券：櫃檯售卡折抵、每人限用、總量上限、限定方案', async () => {
  const m = await newMember('折價甲', '0922000001');
  const m2 = await newMember('折價乙', '0922000002');
  const c = await ok(call('POST', '/api/coupons', { code: 'open500', name: '開幕折 500', discountType: 'AMOUNT', value: 500, maxUses: 1 }, T));
  assert.equal(c.code, 'OPEN500');
  const q = await ok(call('POST', '/api/memberships/quote', { memberId: m.id, planId: pack.id, code: 'open500' }, T));
  assert.equal(q.amount, 3500);
  const ms = await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id, couponCode: 'OPEN500' }, T));
  assert.equal(ms.price, 3500);
  assert.equal(ms.discount, 500);
  await fail(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id, couponCode: 'OPEN500' }, T)); // 已被用完
  await fail(call('POST', '/api/memberships/quote', { memberId: m2.id, planId: pack.id, code: 'OPEN500' }, T));
  const pct = await ok(call('POST', '/api/coupons', { code: 'VIP10', name: '九折', discountType: 'PERCENT', value: 10, planIds: ['nope'] }, T));
  await fail(call('POST', '/api/memberships/quote', { memberId: m2.id, planId: pack.id, code: 'VIP10' }, T)); // 不適用此方案
  await ok(call('PUT', `/api/coupons/${pct.id}`, { planIds: [] }, T));
  assert.equal((await ok(call('POST', '/api/memberships/quote', { memberId: m2.id, planId: pack.id, code: 'vip10' }, T))).amount, 3600);
  await fail(call('DELETE', `/api/coupons/${c.id}`, null, T)); // 用過的不能刪
  await ok(call('DELETE', `/api/coupons/${pct.id}`, null, T));
  assert.equal((await ok(call('GET', '/api/coupons?q=OPEN', null, T))).length, 1);
  assert.equal((await ok(call('GET', '/api/coupons', null, T2))).length, 0);
});

test('線上購買（綠界）：付款通知驗證簽章與金額、重送不重複建立方案', async () => {
  await ok(call('PUT', '/api/studio', { onlinePayEnabled: true }, T));
  const m = await newMember('線上購買', '0922000010');
  const mt = await portalToken(m.id);
  const shop = await ok(call('GET', '/api/portal/shop', null, mt));
  assert.ok(shop.plans.some((p) => p.id === pack.id));
  assert.equal(shop.testMode, true);
  const { order } = await ok(call('POST', '/api/portal/orders', { planId: pack.id, method: 'ONLINE' }, mt));
  const form = await ok(call('POST', `/api/portal/orders/${order.id}/pay`, {}, mt));
  assert.match(form.action, /payment-stage\.ecpay\.com\.tw/);
  assert.equal(form.fields.TotalAmount, '4000');
  const notify = (extra = {}) => {
    const p = { MerchantID: '3002607', MerchantTradeNo: form.fields.MerchantTradeNo, RtnCode: '1', RtnMsg: '交易成功', TradeNo: '2611011234567890', TradeAmt: '4000', PaymentDate: '2026/11/01 12:00:00', PaymentType: 'Credit_CreditCard', PaymentTypeChargeFee: '0', TradeDate: '2026/11/01 11:59:00', SimulatePaid: '0', ...extra };
    p.CheckMacValue = checkMac(p, { hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' });
    return p;
  };
  const post = (p) => fetch(base + '/api/pay/ecpay/notify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p) });
  const bad = notify(); bad.CheckMacValue = 'X'.repeat(64);
  assert.equal((await post(bad)).status, 400);
  const wrongAmt = notify({ TradeAmt: '1' });
  assert.equal((await post(wrongAmt)).status, 400);
  const r = await post(notify());
  assert.equal(await r.text(), '1|OK');
  assert.equal(await (await post(notify())).text(), '1|OK'); // 綠界重送
  const orders = await ok(call('GET', '/api/portal/orders', null, mt));
  assert.equal(orders[0].status, 'PAID');
  assert.equal(await prisma.membership.count({ where: { memberId: m.id } }), 1);
  const me = await ok(call('GET', '/api/portal/me', null, mt));
  assert.equal(me.passes[0].creditsLeft, 10);
  assert.equal(me.passes[0].payMethod, 'CARD');
});

test('轉帳購買：回報後五碼、櫃檯審核通過建立方案；退回不建立', async () => {
  await ok(call('PUT', '/api/studio', { transferEnabled: true, bankInfo: '台灣銀行 004 帳號 123-456-789' }, T));
  const m = await newMember('轉帳會員', '0922000020');
  const mt = await portalToken(m.id);
  const { order } = await ok(call('POST', '/api/portal/orders', { planId: pack.id, method: 'TRANSFER' }, mt));
  await fail(call('POST', `/api/orders/${order.id}/approve`, {}, T)); // 還沒回報
  await fail(call('POST', `/api/portal/orders/${order.id}/transfer`, { last5: '12' }, mt));
  await ok(call('POST', `/api/portal/orders/${order.id}/transfer`, { last5: '54321' }, mt));
  const list = await ok(call('GET', '/api/orders?q=54321', null, T));
  assert.equal(list.length, 1);
  await ok(call('POST', `/api/orders/${order.id}/approve`, {}, T));
  assert.equal(await prisma.membership.count({ where: { memberId: m.id, payMethod: 'TRANSFER' } }), 1);
  await fail(call('DELETE', `/api/orders/${order.id}`, null, T)); // 已付款不能刪
  const { order: o2 } = await ok(call('POST', '/api/portal/orders', { planId: pack.id, method: 'TRANSFER' }, mt));
  await ok(call('POST', `/api/orders/${o2.id}/reject`, { reason: '查無入帳' }, T));
  assert.equal(await prisma.membership.count({ where: { memberId: m.id } }), 1);
  assert.equal((await ok(call('GET', '/api/orders?status=REJECTED', null, T))).length, 1);
  await ok(call('DELETE', `/api/orders/${o2.id}`, null, T));
});

test('體驗方案限首次購買；未開放線上購買的方案不能下單', async () => {
  const trial = await ok(call('POST', '/api/plans', { name: '體驗一堂', kind: 'DROPIN', validDays: 14, price: 300, onlineSale: true, trialOnly: true }, T));
  const hidden = await ok(call('POST', '/api/plans', { name: '櫃檯限定', kind: 'DROPIN', validDays: 14, price: 500 }, T));
  const m = await newMember('體驗會員', '0922000030');
  const mt = await portalToken(m.id);
  assert.ok((await ok(call('GET', '/api/portal/shop', null, mt))).plans.some((p) => p.id === trial.id));
  await fail(call('POST', '/api/portal/orders', { planId: hidden.id, method: 'TRANSFER' }, mt), 404);
  await ok(call('POST', '/api/memberships', { memberId: m.id, planId: trial.id }, T));
  assert.ok(!(await ok(call('GET', '/api/portal/shop', null, mt))).plans.some((p) => p.id === trial.id));
  await fail(call('POST', '/api/memberships', { memberId: m.id, planId: trial.id }, T));
});

test('轉介紹：被介紹者首次購買後，介紹人獲得專屬折價券', async () => {
  await ok(call('PUT', '/api/studio', { referralRewardAmount: 300 }, T));
  const a = await newMember('介紹人', '0922000040');
  const { code } = await ok(call('POST', `/api/members/${a.id}/referral-code`, {}, T));
  assert.match(code, /^R[A-Z0-9]{5}$/);
  await fail(call('PUT', `/api/members/${a.id}`, { referrerCode: code }, T)); // 不能填自己
  const b = await ok(call('POST', '/api/members', { name: '新朋友', phone: '0922000041', referrerCode: code }, T));
  assert.equal(b.referredById, a.id);
  await ok(call('POST', '/api/memberships', { memberId: b.id, planId: pack.id }, T));
  const coupons = await prisma.coupon.findMany({ where: { memberId: a.id } });
  assert.equal(coupons.length, 1);
  assert.equal(coupons[0].value, 300);
  await ok(call('POST', '/api/memberships', { memberId: b.id, planId: pack.id }, T)); // 第二次購買不再發
  assert.equal(await prisma.coupon.count({ where: { memberId: a.id } }), 1);
  const other = await newMember('別人', '0922000042');
  await fail(call('POST', '/api/memberships/quote', { memberId: other.id, planId: pack.id, code: coupons[0].code }, T)); // 限指定會員
  const at = await portalToken(a.id);
  assert.equal((await ok(call('GET', '/api/portal/coupons', null, at))).length, 1);
  const refs = await ok(call('GET', '/api/marketing/referrals', null, T));
  assert.equal(refs[0].count, 1);
  assert.equal(refs[0].converted, 1);
});

test('未到違規：期間內未到達上限，暫停線上預約；櫃檯仍可預約', async () => {
  await ok(call('PUT', '/api/studio', { noShowLimit: 2, noShowWindowDays: 30, noShowSuspendDays: 7 }, T));
  const m = await newMember('常放鳥', '0922000050');
  const ms = await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id }, T));
  for (const ago of [3, 5]) {
    const s = await session(-ago * D);
    await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: m.id, membershipId: ms.id, status: 'NO_SHOW', creditsCharged: 1 } });
  }
  const mt = await portalToken(m.id);
  const s = await session(2 * D);
  const err = await fail(call('POST', '/api/portal/bookings', { sessionId: s.id }, mt));
  assert.match(err.error, /暫停/);
  assert.ok((await ok(call('GET', '/api/portal/me', null, mt))).suspendedUntil);
  await ok(call('POST', '/api/bookings', { sessionId: s.id, memberId: m.id }, T));
  const detail = await ok(call('GET', `/api/members/${m.id}`, null, T));
  assert.equal(detail.violations.count, 2);
  assert.ok(detail.suspendedUntil);
  await ok(call('PUT', '/api/studio', { noShowLimit: 0 }, T));
});

test('會員條款：發布後須同意才能預約或購買；改版後需重新同意', async () => {
  const m = await newMember('條款會員', '0922000060');
  await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id }, T));
  const mt = await portalToken(m.id);
  await ok(call('PUT', '/api/studio/terms', { terms: '一、取消規定：開課前 12 小時。' }, T));
  const s = await session(2 * D);
  const me = await ok(call('GET', '/api/portal/me', null, mt));
  assert.equal(me.terms.version, 1);
  await fail(call('POST', '/api/portal/bookings', { sessionId: s.id }, mt));
  await fail(call('POST', '/api/portal/orders', { planId: pack.id, method: 'TRANSFER' }, mt));
  await fail(call('POST', '/api/portal/terms', { version: 0 }, mt));
  await ok(call('POST', '/api/portal/terms', { version: 1 }, mt));
  await ok(call('POST', '/api/portal/bookings', { sessionId: s.id }, mt));
  await ok(call('PUT', '/api/studio/terms', { terms: '二版條款' }, T));
  assert.equal((await ok(call('GET', '/api/portal/me', null, mt))).terms.version, 2);
  assert.equal((await ok(call('GET', `/api/members/${m.id}`, null, T))).termsOutdated, true);
  await ok(call('PUT', '/api/studio/terms', { terms: '' }, T)); // 取消條款
  assert.equal((await ok(call('GET', '/api/portal/me', null, mt))).terms, null);
});

test('自助簽到：掃 QR code 簽到開課前後的課；token 錯誤或換新後舊的失效', async () => {
  const m = await newMember('簽到會員', '0922000070');
  await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id }, T));
  const s = await session(10 * 60e3);
  const b = await ok(call('POST', '/api/bookings', { sessionId: s.id, memberId: m.id }, T));
  const mt = await portalToken(m.id);
  const info = await ok(call('GET', '/api/studio/checkin', null, T));
  await fail(call('POST', '/api/portal/checkin', { token: 'wrong-token-123' }, mt));
  const r = await ok(call('POST', '/api/portal/checkin', { token: info.token }, mt));
  assert.equal(r.className, '流動瑜珈');
  assert.equal((await prisma.booking.findUnique({ where: { id: b.id } })).status, 'ATTENDED');
  assert.equal((await ok(call('POST', '/api/portal/checkin', { token: info.token }, mt))).already, true);
  const { token } = await ok(call('POST', '/api/studio/checkin/rotate', {}, T));
  assert.notEqual(token, info.token);
  await fail(call('POST', '/api/portal/checkin', { token: info.token }, mt));
});

test('私人課：依教練時段算空檔、預約後空檔消失、同時搶只成功一位、取消釋出', async () => {
  const pt = await ok(call('POST', '/api/class-types', { name: '私人教練課', durationMin: 60, creditCost: 2, isPrivate: true }, T));
  const date = taipeiDay(3);
  const wd = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  await ok(call('PUT', `/api/coaches/${coach.id}/availability`, { slots: [{ weekday: wd, startTime: '10:00', endTime: '12:00' }] }, T));
  const slots = await ok(call('GET', `/api/private/slots?coachId=${coach.id}&classTypeId=${pt.id}&date=${date}`, null, T));
  assert.deepEqual(slots, ['10:00', '10:30', '11:00']);
  const a = await newMember('私教甲', '0922000080');
  const b = await newMember('私教乙', '0922000081');
  await ok(call('POST', '/api/memberships', { memberId: a.id, planId: pack.id }, T));
  await ok(call('POST', '/api/memberships', { memberId: b.id, planId: pack.id }, T));
  const at = await portalToken(a.id), bt = await portalToken(b.id);
  const opts = await ok(call('GET', '/api/portal/private/options', null, at));
  assert.ok(opts.types.some((t) => t.id === pt.id) && opts.coaches.some((c) => c.id === coach.id));
  const body = { coachId: coach.id, classTypeId: pt.id, date, startTime: '10:00' };
  const [r1, r2] = await Promise.all([call('POST', '/api/portal/private/book', body, at), call('POST', '/api/portal/private/book', body, bt)]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
  const won = r1.status === 201 ? r1.data : r2.data;
  assert.equal(won.booking.creditsCharged, 2);
  const after1 = await ok(call('GET', `/api/portal/private/slots?coachId=${coach.id}&classTypeId=${pt.id}&date=${date}`, null, at));
  assert.deepEqual(after1, ['11:00']); // 10:00–11:00 被占用，10:30 也會重疊
  assert.equal(await prisma.classSession.count({ where: { isPrivate: true, coachId: coach.id } }), 1);
  const wonToken = r1.status === 201 ? at : bt;
  await ok(call('POST', `/api/portal/bookings/${won.booking.id}/cancel`, {}, wonToken));
  assert.deepEqual(await ok(call('GET', `/api/private/slots?coachId=${coach.id}&classTypeId=${pt.id}&date=${date}`, null, T)), ['10:00', '10:30', '11:00']);
  // 私人課不出現在團課課表
  const sched = await ok(call('GET', '/api/portal/schedule', null, at));
  assert.ok(!sched.some((s) => s.classType.id === pt.id));
});

test('直播連結只給已預約會員、開課前 15 分鐘起；行事曆訂閱', async () => {
  const m = await newMember('直播會員', '0922000090');
  const x = await newMember('沒預約', '0922000091');
  await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id }, T));
  const soon = await session(10 * 60e3, { liveUrl: 'https://meet.example.com/abc' });
  const later = await session(2 * D, { liveUrl: 'https://meet.example.com/later' });
  const b1 = await ok(call('POST', '/api/bookings', { sessionId: soon.id, memberId: m.id }, T));
  const b2 = await ok(call('POST', '/api/bookings', { sessionId: later.id, memberId: m.id }, T));
  const mt = await portalToken(m.id), xt = await portalToken(x.id);
  assert.equal((await ok(call('GET', `/api/portal/bookings/${b1.id}/live`, null, mt))).url, 'https://meet.example.com/abc');
  await fail(call('GET', `/api/portal/bookings/${b2.id}/live`, null, mt));
  await fail(call('GET', `/api/portal/bookings/${b1.id}/live`, null, xt), 404);
  const me = await ok(call('GET', '/api/portal/me', null, mt));
  const r = await fetch(`${base}/api/cal/${me.member.calendarToken}.ics`);
  const ics = await r.text();
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
  assert.equal((await fetch(`${base}/api/cal/nope.ics`)).status, 404);
});

test('教練薪資：鐘點＋超過門檻每人加給＋產值抽成', async () => {
  const month = taipeiDay(0).slice(0, 7);
  const ms = await prisma.membership.findFirst({ where: { userId, planName: '10 堂卡', price: 4000, creditsTotal: 10 } });
  // 本月內、已結束的課：3 人出席（門檻 2 → 加給 1 人），每人產值 4000/10＝400
  const now = new Date(Date.now() + 8 * H);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 2)); // 本月 1 日 10:00（台北）
  const s = await prisma.classSession.create({ data: { userId, classTypeId: ct.id, coachId: coach.id, startsAt: first, endsAt: new Date(first.getTime() + H), capacity: 5 } });
  const ms3 = await Promise.all([1, 2, 3].map(async (i) => {
    const mem = await newMember(`薪資學員${i}`, `09220001${i}0`);
    await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: mem.id, membershipId: ms.id, status: 'ATTENDED', creditsCharged: 1 } });
  }));
  assert.equal(ms3.length, 3);
  const r = await ok(call('GET', `/api/reports/coach-pay?month=${month}`, null, T));
  const row = r.rows.find((x) => x.coachId === coach.id);
  const d = row.detail.find((x) => x.sessionId === s.id);
  assert.equal(d.heads, 3);
  assert.equal(d.value, 1200);
  assert.equal(d.pay, 800 + 100 + 120);
  const text = await csv(`/api/reports/export/coach-pay?month=${month}`, T);
  assert.ok(text.startsWith('教練,'));
  assert.match(text, /小芸 合計/);
});

test('分店、場地與租借：時段與其他租借或同名教室的課衝突時拒絕', async () => {
  const br = await ok(call('POST', '/api/branches', { name: '信義店' }, T));
  const room = await ok(call('POST', '/api/rooms', { name: 'A 教室', branchId: br.id, hourlyRate: 600 }, T));
  const date = taipeiDay(4);
  const r1 = await ok(call('POST', '/api/rentals', { roomId: room.id, renterName: '外部老師', date, startTime: '14:00', endTime: '16:00' }, T));
  assert.equal(r1.price, 1200);
  await fail(call('POST', '/api/rentals', { roomId: room.id, renterName: '撞期', date, startTime: '15:00', endTime: '17:00' }, T), 409);
  const startsAt = new Date(`${date}T18:00:00+08:00`);
  await prisma.classSession.create({ data: { userId, classTypeId: ct.id, startsAt, endsAt: new Date(startsAt.getTime() + H), capacity: 5, room: 'A 教室' } });
  const clash = await fail(call('POST', '/api/rentals', { roomId: room.id, renterName: '晚上', date, startTime: '18:30', endTime: '19:30' }, T), 409);
  assert.match(clash.error, /流動瑜珈/);
  await ok(call('PUT', `/api/rentals/${r1.id}`, { roomId: room.id, renterName: '外部老師', date, startTime: '13:00', endTime: '15:00', paid: true, payMethod: 'CASH' }, T));
  const list = await ok(call('GET', `/api/rentals?from=${date}&to=${date}&q=外部&paid=yes`, null, T));
  assert.equal(list.length, 1);
  await ok(call('PUT', `/api/rentals/${r1.id}`, { status: 'CANCELLED' }, T));
  await ok(call('POST', '/api/rentals', { roomId: room.id, renterName: '取消後可租', date, startTime: '14:00', endTime: '15:00' }, T));
  await fail(call('DELETE', `/api/rooms/${room.id}`, null, T)); // 有租借紀錄
  await fail(call('DELETE', `/api/branches/${br.id}`, null, T)); // 還有場地
  await ok(call('DELETE', `/api/rentals/${r1.id}`, null, T));
  // 分店課表篩選
  const s = await ok(call('POST', '/api/sessions', { classTypeId: ct.id, date, startTime: '07:00', branchId: br.id }, T));
  const only = await ok(call('GET', `/api/sessions?from=${date}&to=${date}&branchId=${br.id}`, null, T));
  assert.deepEqual(only.map((x) => x.id), [s.id]);
  assert.equal((await ok(call('GET', '/api/rooms', null, T2))).length, 0);
});

test('會員匯入（先預覽再寫入）與匯出 CSV', async () => {
  const rows = [
    { name: '匯入一', phone: '0933000001', planName: '10 堂卡', creditsLeft: '6', endDate: taipeiDay(60) },
    { name: '匯入二', phone: '0933000002', email: 'bad-email' },
    { name: '匯入三', phone: '0933000003', planName: '不存在的方案', creditsLeft: '1', endDate: taipeiDay(10) },
    { name: '匯入一重複', phone: '0933-000-001' },
    { name: '折價甲改名', phone: '0922000001' },
  ];
  const dry = await ok(call('POST', '/api/members/import', { rows, dryRun: true }, T));
  assert.equal(dry.errors, 3);
  assert.equal(await prisma.member.count({ where: { phone: '0933000001' } }), 0);
  const r = await ok(call('POST', '/api/members/import', { rows }, T));
  assert.deepEqual([r.created, r.updated, r.passes, r.errors], [1, 1, 1, 3]);
  const imported = await prisma.member.findFirst({ where: { userId, phone: '0933000001' }, include: { memberships: true } });
  assert.equal(imported.memberships[0].creditsLeft, 6);
  assert.equal(imported.memberships[0].price, 0);
  assert.equal((await prisma.member.findFirst({ where: { userId, phone: '0922000001' } })).name, '折價甲改名');
  for (const url of ['/api/reports/export/sales', '/api/reports/export/attendance']) await csv(url, T);
  const mcsv = await csv('/api/members/export', T);
  assert.match(mcsv, /匯入一,0933000001/);
});

test('群發：依名單篩選、沒綁定 LINE 略過、沙盒模式記錄', async () => {
  const preview = await ok(call('GET', '/api/marketing/segment?segment=noPass', null, T));
  assert.ok(preview.length > 0 && preview.every((m) => m.passes.length === 0));
  const target = preview[0];
  await prisma.member.update({ where: { id: target.id }, data: { lineUserId: 'Utest-line-1' } });
  const c = await ok(call('POST', '/api/campaigns', { name: '回流優惠', segment: 'noPass', message: '{name} 好久不見！', memberIds: [target.id, preview[1]?.id].filter(Boolean) }, T));
  assert.equal(c.sandbox, 1);
  assert.equal(c.skipped, c.total - 1);
  const log = await prisma.reminderLog.findFirst({ where: { kind: 'CAMPAIGN', memberId: target.id } });
  assert.ok(log.message.startsWith(target.name));
  assert.equal((await ok(call('GET', '/api/campaigns?q=回流', null, T))).length, 1);
  await ok(call('DELETE', `/api/campaigns/${c.id}`, null, T));
  for (const seg of ['inactive', 'expiring', 'lowCredit', 'expired', 'birthday', 'newMember', 'all']) await ok(call('GET', `/api/marketing/segment?segment=${seg}`, null, T));
});

test('員工權限：行銷與場地租借是獨立模組', async () => {
  await ok(call('POST', '/api/users', { email: 'v2desk', password: 'pw-123456', name: '櫃檯', permissions: ['schedule'] }, T));
  const S = (await ok(call('POST', '/api/auth/login', { email: 'v2desk', password: 'pw-123456' }))).token;
  await fail(call('GET', '/api/coupons', null, S), 403);
  await fail(call('GET', '/api/rentals', null, S), 403);
  await fail(call('GET', '/api/orders', null, S), 403);
  await ok(call('GET', '/api/studio/checkin', null, S)); // 櫃檯顯示簽到 QR code
  await ok(call('GET', '/api/rooms', null, S)); // 共用唯讀
  await ok(call('GET', '/api/private/options', null, S));
});

test('電子發票（綠界測試環境）：售卡自動開立、作廢方案一併作廢發票', { timeout: 60000 }, async () => {
  await ok(call('PUT', '/api/studio', { invoiceEnabled: true }, T));
  const m = await ok(call('POST', '/api/members', { name: '發票會員', phone: '0922000099', email: 'invoice-test@example.com' }, T));
  const ms = await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id }, T));
  assert.equal(ms.invoiceStatus, 'ISSUED', ms.invoiceError);
  assert.match(ms.invoiceNo, /^[A-Z]{2}\d{8}$/);
  await fail(call('POST', `/api/memberships/${ms.id}/invoice`, {}, T), 409);
  const voided = await ok(call('PUT', `/api/memberships/${ms.id}`, { status: 'CANCELLED' }, T));
  assert.equal(voided.status, 'CANCELLED');
  assert.equal((await prisma.membership.findUnique({ where: { id: ms.id } })).invoiceStatus, 'VOID');
  await ok(call('PUT', '/api/studio', { invoiceEnabled: false }, T));
  // 金鑰不會從設定 API 回傳
  const st = await ok(call('GET', '/api/studio', null, T));
  assert.equal(st.ecpayHashKey, undefined);
  assert.equal(st.ecpayHashKeySet, false);
});
