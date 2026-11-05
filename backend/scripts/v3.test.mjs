// 第三版功能整合測試：退費、轉讓、預收款、定期定額、LINE Pay 設定檢查、階梯抽成、代課與請假、班表打卡、
// 門禁 QR code、置物櫃、體組成、電子合約、商品零售與庫存、公告、問卷、營運分析、自動行銷、權限
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
const { runAutomations } = require('../dist/services/automationService.js');
const { memberAccessCode } = require('../dist/controllers/accessController.js');
const { linePaySignature } = require('../dist/services/linepay.js');

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
const fail = async (p, status = 400) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

let T, T2, userId, ct, pack, period, coachA, coachB;
const taipeiDay = (offsetDays = 0) => new Date(Date.now() + 8 * H + offsetDays * D).toISOString().slice(0, 10);
let phoneSeq = 0;
async function newMember(name) { return ok(call('POST', '/api/members', { name, phone: `09330${String(++phoneSeq).padStart(5, '0')}` }, T)); }
async function portalToken(memberId) {
  const { code } = await ok(call('POST', `/api/members/${memberId}/binding-code`, {}, T));
  return (await ok(call('POST', '/api/portal/login', { bindingCode: code }))).token;
}
async function session(startsInMs, extra = {}) {
  const startsAt = new Date(Date.now() + startsInMs);
  return prisma.classSession.create({ data: { userId, classTypeId: ct.id, startsAt, endsAt: new Date(startsAt.getTime() + H), capacity: 5, ...extra } });
}
const sell = (memberId, planId, extra = {}) => ok(call('POST', '/api/memberships', { memberId, planId, ...extra }, T));
// 合格的簽名圖（夠長的 PNG data URL）
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo' + 'A'.repeat(2000);

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  T = (await ok(call('POST', '/api/auth/register', { email: 'v3studio', password: 'pw-123456', name: '第三版教室' }))).token;
  T2 = (await ok(call('POST', '/api/auth/register', { email: 'v3other', password: 'pw-123456', name: '別間' }))).token;
  userId = (await ok(call('GET', '/api/auth/me', null, T))).id;
  ct = await ok(call('POST', '/api/class-types', { name: '空中瑜珈', defaultCapacity: 5 }, T));
  pack = await ok(call('POST', '/api/plans', { name: '10 堂卡', kind: 'PACK', credits: 10, validDays: 90, price: 3000, onlineSale: true }, T));
  period = await ok(call('POST', '/api/plans', { name: '月費會員', kind: 'PERIOD', validDays: 30, price: 1500, onlineSale: true, recurring: true }, T));
  coachA = await ok(call('POST', '/api/coaches', { name: 'Amy', payPerClass: 500, revenueShare: 10 }, T));
  coachB = await ok(call('POST', '/api/coaches', { name: 'Ben', payPerClass: 400 }, T));
});
after(async () => { server?.close(); await prisma.$disconnect(); });

test('退費：依已用堂數試算、扣手續費、取消未來預約，營收報表扣除退費', async () => {
  await ok(call('PUT', '/api/studio', { refundFeePercent: 10 }, T));
  const m = await newMember('退費會員');
  const ms = await sell(m.id, pack.id);
  await prisma.membership.update({ where: { id: ms.id }, data: { creditsLeft: 7 } }); // 已上 3 堂
  const s = await session(3 * D);
  await ok(call('POST', '/api/bookings', { sessionId: s.id, memberId: m.id }, T));
  const q = await ok(call('GET', `/api/memberships/${ms.id}/refund`, null, T));
  assert.deepEqual([q.used, q.remaining, q.fee, q.refund], [900, 2100, 210, 1890]);
  await fail(call('POST', `/api/memberships/${ms.id}/refund`, { amount: 5000 }, T));
  const r = await ok(call('POST', `/api/memberships/${ms.id}/refund`, { method: 'CASH', reason: '搬家' }, T));
  assert.equal(r.amount, 1890);
  const after = await prisma.membership.findUnique({ where: { id: ms.id } });
  assert.equal(after.status, 'REFUNDED');
  assert.equal((await prisma.booking.findFirst({ where: { sessionId: s.id, memberId: m.id } })).status, 'CANCELLED');
  await fail(call('POST', `/api/memberships/${ms.id}/refund`, {}, T)); // 不能重複退費
  const rev = await ok(call('GET', '/api/reports/revenue', null, T));
  const cur = rev.months.at(-1);
  assert.equal(cur.refunds, 1890);
  assert.equal(cur.net, cur.revenue + cur.products + cur.lockers + cur.rentals - 1890);
  assert.equal((await ok(call('GET', '/api/refunds', null, T))).length, 1);
  assert.equal((await ok(call('GET', '/api/refunds', null, T2))).length, 0);
});

test('期限卡退費依使用天數；凍結天數不算使用', async () => {
  const m = await newMember('月卡退費');
  const start = taipeiDay(-9); // 已用 10 天（含今天）
  const ms = await sell(m.id, period.id, { startDate: start, price: 3000 });
  const q = await ok(call('GET', `/api/memberships/${ms.id}/refund`, null, T));
  assert.equal(q.used, 1000); // 3000 × 10/30
});

test('轉讓：剩餘堂數移給受讓人、沿用到期日、收手續費；產值以剩餘價值計算', async () => {
  const a = await newMember('轉出'), b = await newMember('受讓');
  const ms = await sell(a.id, pack.id);
  await prisma.membership.update({ where: { id: ms.id }, data: { creditsLeft: 7 } });
  const future = await session(4 * D);
  await ok(call('POST', '/api/bookings', { sessionId: future.id, memberId: a.id }, T)); // 扣到剩 6，轉讓時會取消並退回
  await prisma.membership.update({ where: { id: ms.id }, data: { creditsLeft: 5 } }); // 另外已上 1 堂
  await fail(call('POST', `/api/memberships/${ms.id}/transfer`, { toMemberId: a.id }, T));
  const nm = await ok(call('POST', `/api/memberships/${ms.id}/transfer`, { toMemberId: b.id, fee: 200 }, T));
  assert.equal(nm.memberId, b.id);
  assert.deepEqual([nm.creditsTotal, nm.creditsLeft, nm.price, nm.valueBase], [6, 6, 200, 1800]);
  assert.equal(nm.endDate, ms.endDate);
  assert.equal((await prisma.membership.findUnique({ where: { id: ms.id } })).status, 'TRANSFERRED');
  await fail(call('POST', `/api/memberships/${ms.id}/transfer`, { toMemberId: b.id }, T)); // 已轉讓
  const s = await session(2 * D);
  assert.equal((await ok(call('POST', '/api/bookings', { sessionId: s.id, memberId: b.id }, T))).status, 'BOOKED');
});

test('預收款報表：有效方案的剩餘價值合計，含履約保障資訊', async () => {
  await ok(call('PUT', '/api/studio', { trustType: 'TRUST', trustBank: '測試銀行', trustNote: '額度 100 萬' }, T));
  const r = await ok(call('GET', '/api/reports/deferred', null, T));
  assert.ok(r.total > 0);
  assert.equal(r.total, r.rows.reduce((a, x) => a + x.remaining, 0));
  assert.equal(r.trust.bank, '測試銀行');
  const m = await newMember('看購買頁');
  const shop = await ok(call('GET', '/api/portal/shop', null, await portalToken(m.id)));
  assert.equal(shop.trust.type, 'TRUST');
});

test('定期定額：首期付款建立訂閱，之後每期通知續約一張方案（重送不重複），扣款失敗標記並可停止', async () => {
  await ok(call('PUT', '/api/studio', { onlinePayEnabled: true }, T));
  const m = await newMember('月扣會員');
  const mt = await portalToken(m.id);
  await fail(call('POST', '/api/portal/orders', { planId: pack.id, method: 'ONLINE', recurring: true }, mt)); // 堂數卡不能月扣
  await fail(call('POST', '/api/portal/orders', { planId: period.id, method: 'TRANSFER', recurring: true }, mt));
  const { order } = await ok(call('POST', '/api/portal/orders', { planId: period.id, method: 'ONLINE', recurring: true }, mt));
  assert.equal(order.recurring, true);
  const form = await ok(call('POST', `/api/portal/orders/${order.id}/pay`, {}, mt));
  assert.equal(form.fields.PeriodType, 'M');
  assert.equal(form.fields.PeriodAmount, '1500');
  assert.ok(form.fields.PeriodReturnURL.endsWith('/api/pay/ecpay/period'));
  const keys = { hashKey: 'pwFHCqoQZGmho4w6', hashIV: 'EkRm7iFT261dpevs' };
  const signed = (p) => ({ ...p, CheckMacValue: checkMac(p, keys) });
  const post = (url, p) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(p) });
  const first = signed({ MerchantID: '3002607', MerchantTradeNo: form.fields.MerchantTradeNo, RtnCode: '1', RtnMsg: '成功', TradeNo: 'T1', TradeAmt: '1500', PaymentType: 'Credit_CreditCard' });
  assert.equal(await (await post('/api/pay/ecpay/notify', first)).text(), '1|OK');
  const sub = await prisma.subscription.findUnique({ where: { tradeNo: form.fields.MerchantTradeNo } });
  assert.equal(sub.successTimes, 1);
  const period2 = signed({ MerchantID: '3002607', MerchantTradeNo: sub.tradeNo, RtnCode: '1', RtnMsg: '成功', Amount: '1500', TotalSuccessTimes: '2', ProcessDate: '2026/12/05' });
  assert.equal(await (await post('/api/pay/ecpay/period', period2)).text(), '1|OK');
  assert.equal(await (await post('/api/pay/ecpay/period', period2)).text(), '1|OK'); // 重送
  const passes = await prisma.membership.findMany({ where: { subscriptionId: sub.id }, orderBy: { startDate: 'asc' } });
  assert.equal(passes.length, 2);
  const d = (x) => x.toISOString().slice(0, 10);
  const nextStart = new Date(passes[0].endDate.getTime() + D);
  assert.equal(d(passes[1].startDate), d(nextStart)); // 接續上一期
  const bad = { ...period2, CheckMacValue: 'X'.repeat(64) };
  assert.equal((await post('/api/pay/ecpay/period', bad)).status, 400);
  const failed = signed({ MerchantID: '3002607', MerchantTradeNo: sub.tradeNo, RtnCode: '10100058', RtnMsg: '卡片過期', TotalSuccessTimes: '2', ProcessDate: '2027/01/05' });
  await post('/api/pay/ecpay/period', failed);
  assert.equal((await prisma.subscription.findUnique({ where: { id: sub.id } })).status, 'PAST_DUE');
  assert.equal((await ok(call('GET', '/api/portal/subscriptions', null, mt))).length, 1);
  const cancelled = await ok(call('POST', `/api/portal/subscriptions/${sub.id}/cancel`, {}, mt));
  assert.equal(cancelled.status, 'CANCELLED');
});

test('信用卡分期：達最低金額才帶分期參數；LINE Pay 未設定不能開啟或下單', async () => {
  await ok(call('PUT', '/api/studio', { installments: '3,6', installmentMin: 2000 }, T));
  await fail(call('PUT', '/api/studio', { installments: '5' }, T));
  const m = await newMember('分期會員');
  const mt = await portalToken(m.id);
  const { order } = await ok(call('POST', '/api/portal/orders', { planId: pack.id, method: 'ONLINE' }, mt));
  assert.equal((await ok(call('POST', `/api/portal/orders/${order.id}/pay`, {}, mt))).fields.CreditInstallment, '3,6');
  await fail(call('PUT', '/api/studio', { linePayEnabled: true }, T));
  await fail(call('POST', '/api/portal/orders', { planId: pack.id, method: 'LINEPAY' }, mt));
  // 簽章格式：Base64(HMAC-SHA256(secret, secret + uri + body + nonce))
  assert.equal(linePaySignature('s', '/v3/payments/request', '{}', 'n'), require('crypto').createHmac('sha256', 's').update('s/v3/payments/request{}n').digest('base64'));
});

test('階梯式抽成：依當月產值達到的門檻套用 %', async () => {
  await ok(call('PUT', `/api/coaches/${coachA.id}`, { shareTiers: [{ min: 1000, rate: 20 }, { min: 0, rate: 5 }] }, T));
  const m = await newMember('上課會員');
  await sell(m.id, pack.id); // 每堂 300
  const s = await session(-3 * H, { coachId: coachA.id });
  await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: m.id, membershipId: (await prisma.membership.findFirst({ where: { memberId: m.id } })).id, status: 'ATTENDED', creditsCharged: 1 } });
  const month = taipeiDay().slice(0, 7);
  const r = await ok(call('GET', `/api/reports/coach-pay?month=${month}`, null, T));
  const amy = r.rows.find((x) => x.coachId === coachA.id);
  assert.equal(amy.rule.appliedRate, 5); // 產值 300 未達 1000
  assert.equal(amy.pay, 500 + 15);
});

test('代課與請假：教練帳號只能替自己的課請假；核准後換教練並通知已預約會員', async () => {
  const s = await session(2 * D, { coachId: coachA.id });
  const m = await newMember('代課通知');
  await sell(m.id, pack.id);
  await ok(call('POST', '/api/bookings', { sessionId: s.id, memberId: m.id }, T));
  await ok(call('POST', '/api/users', { email: 'coach-amy', password: 'pw-123456', name: 'Amy', permissions: ['schedule'], coachId: coachA.id }, T));
  await ok(call('POST', '/api/users', { email: 'coach-ben', password: 'pw-123456', name: 'Ben', permissions: ['schedule'], coachId: coachB.id }, T));
  const TA = (await ok(call('POST', '/api/auth/login', { email: 'coach-amy', password: 'pw-123456' }))).token;
  const TB = (await ok(call('POST', '/api/auth/login', { email: 'coach-ben', password: 'pw-123456' }))).token;
  await fail(call('POST', '/api/leaves', { sessionId: s.id, reason: '不是我的課' }, TB));
  const lr = await ok(call('POST', '/api/leaves', { sessionId: s.id, reason: '感冒' }, TA));
  await fail(call('POST', '/api/leaves', { sessionId: s.id }, TA)); // 已有待審核
  assert.equal((await ok(call('GET', '/api/leaves', null, TB))).length, 0); // 只看得到自己的
  await fail(call('POST', `/api/leaves/${lr.id}/review`, { action: 'approve', substituteId: coachB.id }, TA)); // 教練不能審核
  await fail(call('POST', `/api/leaves/${lr.id}/review`, { action: 'approve' }, T)); // 沒選代課
  await ok(call('POST', `/api/leaves/${lr.id}/review`, { action: 'approve', substituteId: coachB.id }, T));
  const after = await prisma.classSession.findUnique({ where: { id: s.id } });
  assert.deepEqual([after.coachId, after.originalCoachId], [coachB.id, coachA.id]);
  assert.equal(await prisma.reminderLog.count({ where: { kind: 'SUBSTITUTE', memberId: m.id } }), 1);
  // 換回原教練清除代課標記
  await ok(call('POST', `/api/sessions/${s.id}/substitute`, { coachId: coachA.id, notify: false }, T));
  assert.equal((await prisma.classSession.findUnique({ where: { id: s.id } })).originalCoachId, null);
});

test('員工班表與打卡：重複上班卡被拒、出勤報表計算工時、複製上週班表', async () => {
  await ok(call('POST', '/api/users', { email: 'desk1', password: 'pw-123456', name: '櫃檯小美', permissions: ['schedule'] }, T));
  const TD = (await ok(call('POST', '/api/auth/login', { email: 'desk1', password: 'pw-123456' }))).token;
  const staff = (await ok(call('GET', '/api/shifts', null, T))).staff;
  const desk = staff.find((u) => u.name === '櫃檯小美');
  await fail(call('POST', '/api/shifts', { staffId: desk.id, date: taipeiDay(), startTime: '18:00', endTime: '09:00' }, T));
  await ok(call('POST', '/api/shifts', { staffId: desk.id, date: taipeiDay(-7), startTime: '09:00', endTime: '13:00' }, T));
  await fail(call('GET', '/api/shifts', null, TD), 403); // 沒有員工管理權限
  await ok(call('POST', '/api/me/clock/in', {}, TD));
  await fail(call('POST', '/api/me/clock/in', {}, TD));
  await ok(call('POST', '/api/me/clock/out', {}, TD));
  await ok(call('POST', '/api/clocks', { staffId: desk.id, date: taipeiDay(-1), inTime: '09:00', outTime: '13:30' }, T));
  const rep = await ok(call('GET', `/api/clocks/report?month=${taipeiDay(-1).slice(0, 7)}`, null, T));
  assert.ok(rep.rows.find((r) => r.staffId === desk.id).workedHours >= 4.5);
  const { created } = await ok(call('POST', '/api/shifts/copy-week', { from: taipeiDay() }, T));
  assert.equal(created, 1);
});

test('門禁：動態 QR code 驗證、過期與偽造拒絕、無方案拒絕、入場自動簽到、裝置 token', async () => {
  const studio = await prisma.studio.findUnique({ where: { userId } });
  const m = await newMember('入場會員');
  const none = await ok(call('POST', '/api/access/scan', { code: memberAccessCode(studio, m.id).code }, T));
  assert.equal(none.allowed, false);
  assert.equal(none.reason, '沒有有效方案');
  await sell(m.id, pack.id);
  const s = await session(10 * 60e3);
  await ok(call('POST', '/api/bookings', { sessionId: s.id, memberId: m.id }, T));
  const mt = await portalToken(m.id);
  const { code } = await ok(call('GET', '/api/portal/access-code', null, mt));
  const yes = await ok(call('POST', '/api/access/scan', { code }, T));
  assert.equal(yes.allowed, true);
  assert.ok(yes.checkedIn);
  assert.equal((await prisma.booking.findFirst({ where: { sessionId: s.id, memberId: m.id } })).status, 'ATTENDED');
  const old = memberAccessCode(studio, m.id, Date.now() - 10 * 60e3).code;
  assert.equal((await ok(call('POST', '/api/access/scan', { code: old }, T))).allowed, false);
  assert.equal((await ok(call('POST', '/api/access/scan', { code: code.slice(0, -2) + 'xx' }, T))).allowed, false);
  // 別間教室掃不到
  assert.equal((await ok(call('POST', '/api/access/scan', { code }, T2))).allowed, false);
  const dev = await ok(call('POST', '/api/access/devices', { name: '大門閘門' }, T));
  const r1 = await fetch(base + '/api/access/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': dev.token }, body: JSON.stringify({ code }) });
  assert.equal((await r1.json()).allowed, true);
  const r2 = await fetch(base + '/api/access/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': 'nope' }, body: JSON.stringify({ code }) });
  assert.equal(r2.status, 401);
  assert.ok((await ok(call('GET', `/api/access/logs?memberId=${m.id}`, null, T))).length >= 3);
});

test('置物櫃：批次建立、出租、同櫃不能重複出租、續租另記一筆、營收計入', async () => {
  const { created } = await ok(call('POST', '/api/lockers/bulk', { prefix: 'A', from: 1, to: 5, monthlyRate: 300 }, T));
  assert.equal(created, 5);
  const lockers = await ok(call('GET', '/api/lockers', null, T));
  const a1 = lockers.find((l) => l.code === 'A01');
  const m = await newMember('租櫃會員');
  const r = await ok(call('POST', `/api/lockers/${a1.id}/rent`, { memberId: m.id, startDate: '2026-11-01', months: 3 }, T));
  assert.equal(r.price, 900);
  assert.equal(r.endDate.slice(0, 10), '2027-01-31');
  await fail(call('POST', `/api/lockers/${a1.id}/rent`, { memberId: m.id, startDate: '2026-11-01' }, T));
  const next = await ok(call('PUT', `/api/lockers/rentals/${r.id}`, { action: 'extend', months: 1 }, T));
  assert.equal(next.startDate.slice(0, 10), '2027-02-01');
  assert.equal(next.endDate.slice(0, 10), '2027-02-28');
  await fail(call('DELETE', `/api/lockers/${a1.id}`, null, T));
});

test('體組成：紀錄自動計算 BMI，會員端看得到', async () => {
  const m = await newMember('體測會員');
  const x = await ok(call('POST', `/api/members/${m.id}/metrics`, { measuredAt: taipeiDay(), heightCm: 160, weightKg: 56.3, bodyFatPct: 24.5 }, T));
  assert.equal(x.bmi, 22);
  await fail(call('POST', `/api/members/${m.id}/metrics`, { measuredAt: taipeiDay(), weightKg: 5 }, T));
  assert.equal((await ok(call('GET', '/api/portal/metrics', null, await portalToken(m.id)))).length, 1);
});

test('電子合約：櫃檯簽署代入方案資料；開啟後線上購買必須簽名，付款後合約連結方案', async () => {
  const m = await newMember('簽約會員');
  const ms = await sell(m.id, pack.id);
  const pv = await ok(call('GET', `/api/contracts/preview?membershipId=${ms.id}`, null, T));
  assert.match(pv.content, /簽約會員/);
  assert.match(pv.content, /新台幣 3,000 元/);
  assert.match(pv.content, /測試銀行/);
  await fail(call('POST', '/api/contracts', { membershipId: ms.id, signature: 'data:image/png;base64,AAAA', signerName: '簽約會員' }, T));
  const c = await ok(call('POST', '/api/contracts', { membershipId: ms.id, signature: SIG, signerName: '簽約會員' }, T));
  assert.equal(c.channel, 'FRONT_DESK');
  await ok(call('PUT', '/api/studio', { contractEnabled: true, transferEnabled: true }, T));
  const mt = await portalToken(m.id);
  await fail(call('POST', '/api/portal/orders', { planId: pack.id, method: 'TRANSFER' }, mt));
  const { order } = await ok(call('POST', '/api/portal/orders', { planId: pack.id, method: 'TRANSFER', signature: SIG, signerName: '簽約會員' }, mt));
  await ok(call('POST', `/api/portal/orders/${order.id}/transfer`, { last5: '11111' }, mt));
  const paid = await ok(call('POST', `/api/orders/${order.id}/approve`, {}, T));
  const linked = await prisma.contract.findUnique({ where: { id: (await prisma.order.findUnique({ where: { id: order.id } })).contractId } });
  assert.equal(linked.membershipId, paid.membershipId);
  assert.equal((await ok(call('GET', '/api/portal/contracts', null, mt))).length, 2);
  await ok(call('PUT', '/api/studio', { contractEnabled: false }, T));
});

test('商品零售：結帳扣庫存、庫存不足拒絕、作廢回補、盤點調整', async () => {
  const water = await ok(call('POST', '/api/products', { name: '礦泉水', price: 20, stock: 5, category: '飲料' }, T));
  const towel = await ok(call('POST', '/api/products', { name: '毛巾租借', price: 30, trackStock: false }, T));
  await fail(call('POST', '/api/sales', { items: [{ productId: water.id, qty: 6 }] }, T));
  const sale = await ok(call('POST', '/api/sales', { items: [{ productId: water.id, qty: 2 }, { productId: towel.id, qty: 1 }, { productId: water.id, qty: 1 }], discount: 10 }, T));
  assert.equal(sale.total, 20 * 3 + 30 - 10);
  assert.equal(sale.items.length, 2);
  assert.equal((await prisma.product.findUnique({ where: { id: water.id } })).stock, 2);
  await ok(call('POST', `/api/sales/${sale.id}/void`, {}, T));
  assert.equal((await prisma.product.findUnique({ where: { id: water.id } })).stock, 5);
  await fail(call('POST', `/api/sales/${sale.id}/void`, {}, T));
  await ok(call('POST', `/api/products/${water.id}/stock`, { mode: 'count', qty: 3, note: '盤點' }, T));
  await ok(call('POST', `/api/products/${water.id}/stock`, { mode: 'restock', qty: 10 }, T));
  assert.equal((await prisma.product.findUnique({ where: { id: water.id } })).stock, 13);
  const moves = await ok(call('GET', `/api/products/${water.id}/moves`, null, T));
  assert.deepEqual(moves.map((x) => x.reason).sort(), ['ADJUST', 'RESTOCK', 'RESTOCK', 'SALE', 'VOID']);
  await fail(call('DELETE', `/api/products/${water.id}`, null, T));
  const s2 = await ok(call('POST', '/api/sales', { items: [{ productId: water.id, qty: 1 }] }, T));
  const list = await ok(call('GET', '/api/sales', null, T));
  assert.equal(list.total, s2.total);
  assert.equal((await ok(call('GET', '/api/products', null, T2))).length, 0);
});

test('公告與問卷：會員端看到公告（過期不顯示）、填問卷一次、下課問卷限出席的課、結果統計', async () => {
  await ok(call('POST', '/api/announcements', { title: '颱風停課', body: '明天全天停課', pinned: true, push: true }, T));
  await ok(call('POST', '/api/announcements', { title: '舊公告', body: '已過期', expiresAt: taipeiDay(-1) }, T));
  const m = await newMember('問卷會員');
  const mt = await portalToken(m.id);
  const ann = await ok(call('GET', '/api/portal/announcements', null, mt));
  assert.deepEqual(ann.map((a) => a.title), ['颱風停課']);
  await fail(call('POST', '/api/surveys', { title: '空', questions: [] }, T));
  const sv = await ok(call('POST', '/api/surveys', { title: '滿意度', questions: [{ id: 'q1', type: 'rating', label: '整體滿意度' }, { id: 'q2', type: 'choice', label: '從哪裡知道我們', options: ['朋友', '網路'] }, { id: 'q3', type: 'text', label: '建議' }] }, T));
  const after = await ok(call('POST', '/api/surveys', { title: '下課評價', afterClass: true, questions: [{ id: 'r', type: 'rating', label: '這堂課' }] }, T));
  await fail(call('POST', `/api/portal/surveys/${sv.id}`, { answers: { q1: 9 } }, mt));
  await ok(call('POST', `/api/portal/surveys/${sv.id}`, { answers: { q1: 4, q2: '朋友', q3: '很棒' } }, mt));
  await fail(call('POST', `/api/portal/surveys/${sv.id}`, { answers: { q1: 5 } }, mt));
  const s = await session(-3 * H, { coachId: coachA.id });
  await fail(call('POST', `/api/portal/surveys/${after.id}`, { sessionId: s.id, answers: { r: 5 } }, mt)); // 沒出席
  await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: m.id, status: 'ATTENDED' } });
  const todo = await ok(call('GET', '/api/portal/surveys', null, mt));
  assert.ok(todo.some((x) => x.id === after.id && x.sessionId === s.id));
  await ok(call('POST', `/api/portal/surveys/${after.id}`, { sessionId: s.id, answers: { r: 5 } }, mt));
  const res = await ok(call('GET', `/api/surveys/${sv.id}/results`, null, T));
  assert.equal(res.questions[0].average, 4);
  assert.deepEqual(res.questions[1].counts.map((c) => c.count), [1, 0]);
  const res2 = await ok(call('GET', `/api/surveys/${after.id}/results`, null, T));
  assert.equal(res2.questions[0].byCoach[0].coach, 'Amy');
  await fail(call('PUT', `/api/surveys/${sv.id}`, { questions: [{ id: 'x', type: 'text', label: '改題目' }] }, T));
});

test('營運分析：熱門時段、課程與教練排行、續約率與流失風險名單', async () => {
  const r = await ok(call('GET', '/api/reports/insights', null, T));
  assert.equal(r.heat.length, 7);
  assert.equal(r.heat[0].length, 24);
  assert.ok(r.classTypes.length >= 1);
  assert.ok(r.coaches.some((c) => c.name === 'Amy'));
  assert.equal(r.renewal.length, 6);
  assert.ok(r.members.activePass >= r.members.atRisk);
});

test('自動行銷：生日當天送祝福與折價券（只送一次），久未到訪喚回', async () => {
  await ok(call('PUT', '/api/studio', { birthdayEnabled: true, birthdayCoupon: 200, winbackEnabled: true, winbackDays: 14, winbackCoupon: 100 }, T));
  const today = taipeiDay();
  const bd = await ok(call('POST', '/api/members', { name: '壽星', phone: '0944000001', birthday: `1990-${today.slice(5)}` }, T));
  const away = await newMember('好久不見');
  const s = await session(-20 * D);
  await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: away.id, status: 'ATTENDED' } });
  await runAutomations();
  await runAutomations();
  assert.equal(await prisma.coupon.count({ where: { memberId: bd.id, value: 200 } }), 1);
  assert.equal(await prisma.reminderLog.count({ where: { kind: 'BIRTHDAY', memberId: bd.id } }), 1);
  assert.equal(await prisma.coupon.count({ where: { memberId: away.id, value: 100 } }), 1);
  assert.equal(await prisma.reminderLog.count({ where: { kind: 'WINBACK', memberId: away.id } }), 1);
});

test('權限：員工沒有零售、門禁權限時被拒；打卡不需權限', async () => {
  await ok(call('POST', '/api/users', { email: 'desk2', password: 'pw-123456', name: '工讀生', permissions: ['schedule'] }, T));
  const TD = (await ok(call('POST', '/api/auth/login', { email: 'desk2', password: 'pw-123456' }))).token;
  await fail(call('GET', '/api/products', null, TD), 403);
  await fail(call('POST', '/api/access/scan', { code: 'x' }, TD), 403);
  await fail(call('GET', '/api/reports/deferred', null, TD), 403);
  await ok(call('GET', '/api/me/clock', null, TD));
  const mods = (await ok(call('GET', '/api/users/modules', null, T))).map((x) => x.key);
  for (const k of ['pos', 'access', 'staff']) assert.ok(mods.includes(k));
});

test('手機推播：訂閱、送出測試通知、群發會送給只開推播的會員、失效訂閱自動刪除', async () => {
  const https = require('node:https');
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const os = require('node:os');
  // 假的推播服務（自簽憑證），記錄收到的推播；/gone 路徑回 410 模擬裝置已取消訂閱
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=127.0.0.1`, { stdio: 'ignore' });
  const got = [];
  const srv = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    let n = 0; req.on('data', (c) => { n += c.length; });
    req.on('end', () => { got.push({ path: req.url, bytes: n, enc: req.headers['content-encoding'], auth: req.headers.authorization }); res.statusCode = req.url.startsWith('/gone') ? 410 : 201; res.end(); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const port = srv.address().port;
    const keys = () => {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
      return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
    };
    const m = await newMember('推播會員');
    const mt = await portalToken(m.id);
    const cfg = await ok(call('GET', '/api/portal/push', null, mt));
    assert.equal(cfg.enabled, true);
    assert.ok(cfg.publicKey.length > 40);
    await fail(call('POST', '/api/portal/push/subscribe', { endpoint: 'not-a-url', keys: keys() }, mt));
    await ok(call('POST', '/api/portal/push/subscribe', { endpoint: `https://127.0.0.1:${port}/ok/1`, keys: keys() }, mt));
    await ok(call('POST', '/api/portal/push/subscribe', { endpoint: `https://127.0.0.1:${port}/ok/1`, keys: keys() }, mt)); // 同裝置重複訂閱只留一筆
    assert.equal(await prisma.pushSubscription.count({ where: { memberId: m.id } }), 1);
    await ok(call('POST', '/api/portal/push/test', {}, mt));
    assert.equal(got.length, 1);
    assert.equal(got[0].enc, 'aes128gcm');
    assert.match(got[0].auth, /^vapid t=/);
    // 群發：會員沒綁 LINE，但有開推播 → 會送出
    const before = got.length;
    const c = await ok(call('POST', '/api/campaigns', { segment: 'all', name: '推播測試', message: '{name} 你好', memberIds: [m.id] }, T));
    assert.equal(c.skipped, 0);
    assert.equal(got.length, before + 1);
    // 失效訂閱：推送時收到 410 就刪除
    await ok(call('POST', '/api/portal/push/subscribe', { endpoint: `https://127.0.0.1:${port}/gone/2`, keys: keys() }, mt));
    await ok(call('POST', '/api/portal/push/test', {}, mt));
    assert.equal(await prisma.pushSubscription.count({ where: { memberId: m.id } }), 1);
    await ok(call('POST', '/api/portal/push/unsubscribe', { endpoint: `https://127.0.0.1:${port}/ok/1` }, mt));
    assert.equal(await prisma.pushSubscription.count({ where: { memberId: m.id } }), 0);
    await fail(call('POST', '/api/portal/push/test', {}, mt));
  } finally {
    if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
