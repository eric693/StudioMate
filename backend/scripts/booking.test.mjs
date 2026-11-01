// 預約規則整合測試：使用獨立的測試資料庫（TEST_DATABASE_URL），每次執行前重建。
// 執行：npm run build && npm test
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
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // 一定要在載入 app 之前切換
process.env.DISABLE_SCHEDULER = 'true';
process.env.ALLOW_REGISTER = 'true';
execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd: ROOT, env: process.env, stdio: 'ignore' });

const { default: app, prisma } = require('../dist/app.js');
const { closeFinishedSessions } = require('../dist/services/bookingService.js');
const { runReminders } = require('../dist/services/reminderService.js');
const { refreshMembershipStatus } = require('../dist/services/membershipService.js');

let server, base;
const H = 3600e3, D = 86400e3;

async function call(method, url, body, token) {
  const r = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
const ok = async (p) => { const r = await p; assert.ok(r.status < 300, `預期成功，實際 ${r.status}：${JSON.stringify(r.data)}`); return r.data; };

let T, T2, userId, ct, ctPrivate, pack, period;
const members = {};

/** 直接建立指定時間的課程（測試需要精確控制「距離開課多久」） */
async function session(startsInMs, { capacity = 2, classTypeId = ct.id, owner = userId } = {}) {
  const startsAt = new Date(Date.now() + startsInMs);
  return prisma.classSession.create({ data: { userId: owner, classTypeId, startsAt, endsAt: new Date(startsAt.getTime() + H), capacity } });
}
const credits = async (membershipId) => (await prisma.membership.findUnique({ where: { id: membershipId } })).creditsLeft;
const book = (sessionId, memberId, token = T) => call('POST', '/api/bookings', { sessionId, memberId }, token);

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  T = (await ok(call('POST', '/api/auth/register', { email: 'studio1', password: 'pw-123456', name: '測試瑜珈教室' }))).token;
  T2 = (await ok(call('POST', '/api/auth/register', { email: 'studio2', password: 'pw-123456', name: '另一間教室' }))).token;
  userId = (await ok(call('GET', '/api/auth/me', null, T))).id;
  await ok(call('PUT', '/api/studio', { cancelDeadlineHours: 12, lateCancelForfeit: true, waitlistEnabled: true }, T));
  ct = await ok(call('POST', '/api/class-types', { name: '哈達瑜珈', defaultCapacity: 2 }, T));
  ctPrivate = await ok(call('POST', '/api/class-types', { name: '私人課', creditCost: 2 }, T));
  pack = await ok(call('POST', '/api/plans', { name: '10 堂卡', kind: 'PACK', credits: 10, validDays: 60, price: 3000, classTypeIds: [ct.id] }, T));
  period = await ok(call('POST', '/api/plans', { name: '月卡', kind: 'PERIOD', validDays: 30, price: 2500, dailyLimit: 1 }, T));
  for (const [k, phone] of [['A', '0911000001'], ['B', '0911000002'], ['C', '0911000003'], ['D', '0911000004'], ['E', '0911000005']]) {
    members[k] = await ok(call('POST', '/api/members', { name: `會員${k}`, phone }, T));
  }
});
after(async () => { server?.close(); await prisma.$disconnect(); });

test('有名額正取並扣堂；額滿排候補不扣堂；重複預約被拒', async () => {
  const s = await session(2 * D);
  const pa = await ok(call('POST', '/api/memberships', { memberId: members.A.id, planId: pack.id }, T));
  const pb = await ok(call('POST', '/api/memberships', { memberId: members.B.id, planId: pack.id }, T));
  const pc = await ok(call('POST', '/api/memberships', { memberId: members.C.id, planId: pack.id }, T));
  assert.equal((await ok(book(s.id, members.A.id))).status, 'BOOKED');
  assert.equal((await ok(book(s.id, members.B.id))).status, 'BOOKED');
  const w = await ok(book(s.id, members.C.id));
  assert.equal(w.status, 'WAITLIST');
  assert.equal(w.creditsCharged, 0);
  assert.deepEqual([await credits(pa.id), await credits(pb.id), await credits(pc.id)], [9, 9, 10]);
  assert.equal((await book(s.id, members.A.id)).status, 409);
});

test('截止前取消退堂，並自動遞補第一位候補（遞補時才扣堂）且產生通知', async () => {
  const s = await session(3 * D);
  await ok(book(s.id, members.A.id)); await ok(book(s.id, members.B.id));
  const w = await ok(book(s.id, members.C.id));
  const a = await prisma.booking.findFirst({ where: { sessionId: s.id, memberId: members.A.id } });
  const before = await credits(a.membershipId);
  const r = await ok(call('POST', `/api/bookings/${a.id}/cancel`, {}, T));
  assert.equal(r.booking.status, 'CANCELLED');
  assert.equal(r.refunded, true);
  assert.equal(await credits(a.membershipId), before + 1);
  assert.equal(r.promoted.id, w.id);
  assert.equal(r.promoted.status, 'BOOKED');
  assert.equal(r.promoted.creditsCharged, 1);
  const log = await prisma.reminderLog.findFirst({ where: { kind: 'PROMOTED', refId: w.id } });
  assert.ok(log, '應該記錄遞補通知（沙盒模式）');
  assert.equal(log.channel, 'SANDBOX');
});

test('截止後取消算晚取消並扣堂；教室人員可例外退堂；會員在開課後不能取消', async () => {
  const s = await session(2 * H, { capacity: 5 }); // 截止時間 12 小時，已經過了
  const ba = await ok(book(s.id, members.A.id));
  const bb = await ok(book(s.id, members.B.id));
  const ca = await credits(ba.membershipId), cb = await credits(bb.membershipId);
  const late = await ok(call('POST', `/api/bookings/${ba.id}/cancel`, {}, T));
  assert.equal(late.booking.status, 'LATE_CANCELLED');
  assert.equal(await credits(ba.membershipId), ca);
  const forced = await ok(call('POST', `/api/bookings/${bb.id}/cancel`, { forceRefund: true }, T));
  assert.equal(forced.booking.status, 'CANCELLED');
  assert.equal(await credits(bb.membershipId), cb + 1);

  const started = await session(-10 * 60e3, { capacity: 5 });
  const bc = await ok(book(started.id, members.C.id)); // 教室人員可在上課中補登
  const code = (await ok(call('POST', `/api/members/${members.C.id}/binding-code`, {}, T))).code;
  const mt = (await ok(call('POST', '/api/portal/login', { bindingCode: code }))).token;
  assert.equal((await call('POST', `/api/portal/bookings/${bc.id}/cancel`, {}, mt)).status, 400);
  assert.equal((await call('POST', '/api/portal/bookings', { sessionId: started.id }, mt)).status, 400);
});

test('沒有方案、方案不適用課程類型或堂數不足時不能預約', async () => {
  const s = await session(2 * D);
  assert.equal((await book(s.id, members.D.id)).status, 400); // D 沒有任何方案
  const priv = await session(2 * D, { classTypeId: ctPrivate.id });
  assert.equal((await book(priv.id, members.A.id)).status, 400); // 10 堂卡限定哈達瑜珈
});

test('多張可用方案時優先扣最快到期的那張', async () => {
  const today = new Date(Date.now() + 8 * H).toISOString().slice(0, 10);
  const later = await ok(call('POST', '/api/memberships', { memberId: members.D.id, planId: pack.id, startDate: today }, T));
  const sooner = await ok(call('POST', '/api/memberships', { memberId: members.D.id, planId: pack.id, startDate: today }, T));
  await ok(call('PUT', `/api/memberships/${sooner.id}`, { endDate: new Date(Date.now() + 10 * D).toISOString().slice(0, 10) }, T));
  const s = await session(2 * D);
  const b = await ok(book(s.id, members.D.id));
  assert.equal(b.membershipId, sooner.id);
  assert.equal(await credits(later.id), 10);
});

test('期限卡每日上限：同一天第二堂被拒；期限卡不扣堂', async () => {
  const m = await ok(call('POST', '/api/memberships', { memberId: members.E.id, planId: period.id }, T));
  // 固定在台北同一天的 10:00 與 12:00，避免深夜執行時兩堂跨日
  const day = new Date(Date.now() + 8 * H + 2 * D).toISOString().slice(0, 10);
  const at = (hm) => new Date(`${day}T${hm}:00+08:00`).getTime() - Date.now();
  const s1 = await session(at('10:00'), { capacity: 10 });
  const s2 = await session(at('12:00'), { capacity: 10 });
  const b1 = await ok(book(s1.id, members.E.id));
  assert.equal(b1.membershipId, m.id);
  assert.equal(b1.creditsCharged, 0);
  assert.equal((await book(s2.id, members.E.id)).status, 400);
});

test('多人同時搶最後一個名額：只有一人正取，堂數只扣一次', async () => {
  const s = await session(4 * D, { capacity: 1 });
  const ids = [members.A.id, members.B.id, members.C.id, members.D.id];
  const results = await Promise.all(ids.map((id) => book(s.id, id)));
  assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.data)));
  const booked = results.filter((r) => r.data.status === 'BOOKED');
  assert.equal(booked.length, 1);
  assert.equal(results.filter((r) => r.data.status === 'WAITLIST').length, 3);
  assert.equal(await prisma.booking.count({ where: { sessionId: s.id, status: 'BOOKED' } }), 1);
});

test('加大名額自動遞補候補；教室取消整堂課全部退堂並取消候補', async () => {
  const s = await session(5 * D, { capacity: 1 });
  const b1 = await ok(book(s.id, members.A.id));
  const w = await ok(book(s.id, members.B.id));
  await ok(call('PUT', `/api/sessions/${s.id}`, { capacity: 2 }, T));
  assert.equal((await prisma.booking.findUnique({ where: { id: w.id } })).status, 'BOOKED');
  assert.equal((await call('PUT', `/api/sessions/${s.id}`, { capacity: 1 }, T)).status, 400); // 不能少於已正取人數

  const w2 = await ok(book(s.id, members.C.id));
  const c1 = await credits(b1.membershipId);
  const r = await ok(call('POST', `/api/sessions/${s.id}/cancel`, { reason: '教練請假' }, T));
  assert.equal(r.affected, 3);
  assert.equal(await credits(b1.membershipId), c1 + 1);
  assert.equal((await prisma.booking.findUnique({ where: { id: w2.id } })).status, 'CANCELLED');
  assert.equal((await book(s.id, members.D.id)).status, 400); // 已取消的課不能預約
});

test('課程結束收尾：自動出席或標為未到，候補取消', async () => {
  // 已結束的課不能再透過 API 預約，直接建立「開課前就預約好」的紀錄
  const s = await session(-3 * H, { capacity: 1 });
  await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: members.A.id, status: 'BOOKED' } });
  await prisma.booking.create({ data: { userId, sessionId: s.id, memberId: members.B.id, status: 'WAITLIST' } });
  await closeFinishedSessions();
  assert.equal((await prisma.booking.findFirst({ where: { sessionId: s.id, memberId: members.A.id } })).status, 'ATTENDED');
  assert.equal((await prisma.booking.findFirst({ where: { sessionId: s.id, memberId: members.B.id } })).status, 'CANCELLED');

  await ok(call('PUT', '/api/studio', { autoAttend: false }, T));
  const s2 = await session(-3 * H, { capacity: 3 });
  await prisma.booking.create({ data: { userId, sessionId: s2.id, memberId: members.A.id, status: 'BOOKED' } });
  await closeFinishedSessions();
  assert.equal((await prisma.booking.findFirst({ where: { sessionId: s2.id } })).status, 'NO_SHOW');
  await ok(call('PUT', '/api/studio', { autoAttend: true }, T));
});

test('凍結期間不能預約、到期日順延；提前解凍扣回未使用天數；過期方案自動失效', async () => {
  const day = (ms) => new Date(Date.now() + 8 * H + ms).toISOString().slice(0, 10); // 台北日期
  const m = await ok(call('POST', '/api/memberships', { memberId: members.E.id, planId: pack.id }, T));
  const end0 = m.endDate.slice(0, 10);
  const f = await ok(call('POST', `/api/memberships/${m.id}/freeze`, { from: day(D), until: day(10 * D) }, T));
  assert.equal(f.endDate.slice(0, 10), new Date(Date.parse(end0) + 10 * D).toISOString().slice(0, 10));
  const s = await session(3 * D, { classTypeId: ct.id, capacity: 10 });
  const r = await book(s.id, members.E.id);
  assert.notEqual(r.data.membershipId, m.id, '凍結中的方案不能被使用');
  const u = await ok(call('POST', `/api/memberships/${m.id}/unfreeze`, {}, T));
  assert.equal(u.endDate.slice(0, 10), end0);

  const old = await ok(call('POST', '/api/memberships', { memberId: members.D.id, planId: period.id, startDate: day(-40 * D) }, T));
  await refreshMembershipStatus();
  assert.equal((await prisma.membership.findUnique({ where: { id: old.id } })).status, 'EXPIRED');
});

test('固定課表：台北 19:00 對應 UTC 11:00；重複產生不會重複建立；修改時已有預約的課保留', async () => {
  const t = await ok(call('POST', '/api/templates', { classTypeId: ct.id, weekday: 2, startTime: '19:00' }, T));
  const count = () => prisma.classSession.count({ where: { templateId: t.template.id } });
  const n1 = await count();
  assert.ok(n1 >= 2, `14 天內應有 2 堂以上，實際 ${n1}`);
  const first = await prisma.classSession.findFirst({ where: { templateId: t.template.id }, orderBy: { startsAt: 'asc' } });
  assert.equal(first.startsAt.getUTCHours(), 11);
  assert.equal(first.startsAt.getUTCMinutes(), 0);
  await ok(call('POST', '/api/templates/generate', {}, T));
  assert.equal(await count(), n1);

  await ok(book(first.id, members.A.id));
  const r = await ok(call('PUT', `/api/templates/${t.template.id}`, { startTime: '20:00' }, T));
  assert.equal(r.kept, 1);
  assert.equal((await prisma.classSession.findUnique({ where: { id: first.id } })).startsAt.getUTCHours(), 11);
  const moved = await prisma.classSession.findMany({ where: { templateId: t.template.id, NOT: { id: first.id } } });
  assert.ok(moved.length >= 1 && moved.every((x) => x.startsAt.getUTCHours() === 12));
});

test('多租戶隔離：另一間教室看不到也動不了這間的資料', async () => {
  const s = await session(2 * D);
  assert.equal((await call('GET', `/api/members/${members.A.id}`, null, T2)).status, 404);
  assert.equal((await call('GET', `/api/sessions/${s.id}`, null, T2)).status, 404);
  assert.equal((await book(s.id, members.A.id, T2)).status, 404);
  assert.equal((await call('GET', '/api/members', null, T2)).data.length, 0);
  assert.equal((await call('POST', '/api/memberships', { memberId: members.A.id, planId: pack.id }, T2)).status, 404);
});

test('會員端：綁定碼登入、課表顯示自己的預約、預約與取消；教室 token 不能用在會員 API', async () => {
  const s = await session(3 * D, { capacity: 5 });
  const code = (await ok(call('POST', `/api/members/${members.A.id}/binding-code`, {}, T))).code;
  const mt = (await ok(call('POST', '/api/portal/login', { bindingCode: code }))).token;
  const me = await ok(call('GET', '/api/portal/me', null, mt));
  assert.equal(me.member.name, '會員A');
  const b = await ok(call('POST', '/api/portal/bookings', { sessionId: s.id }, mt));
  const sched = await ok(call('GET', '/api/portal/schedule', null, mt));
  const row = sched.find((x) => x.id === s.id);
  assert.equal(row.myBooking.id, b.id);
  assert.equal(row.spotsLeft, 4);
  const c = await ok(call('POST', `/api/portal/bookings/${b.id}/cancel`, {}, mt));
  assert.equal(c.refunded, true);
  assert.equal((await call('GET', '/api/portal/me', null, T)).status, 401);
  assert.equal((await call('GET', '/api/dashboard', null, mt)).status, 401);
  assert.equal((await call('POST', '/api/portal/login', { bindingCode: 'ZZZZZZ' })).status, 401);
});

test('上課提醒只送一次；員工沒有權限的模組被拒', async () => {
  const s = await session(2 * H, { capacity: 5 });
  const b = await ok(book(s.id, members.B.id));
  await runReminders(); await runReminders();
  assert.equal(await prisma.reminderLog.count({ where: { kind: 'CLASS', refId: b.id } }), 1);

  const staff = await ok(call('POST', '/api/users', { email: 'desk', password: 'pw-123456', name: '櫃檯', permissions: ['schedule'] }, T));
  assert.ok(staff.id);
  const st = (await ok(call('POST', '/api/auth/login', { email: 'desk', password: 'pw-123456' }))).token;
  assert.equal((await call('GET', `/api/sessions/${s.id}`, null, st)).status, 200);
  assert.equal((await call('GET', '/api/reports/revenue', null, st)).status, 403);
  assert.equal((await call('GET', `/api/members/${members.A.id}`, null, st)).status, 403);
});

test('總覽與營收報表', async () => {
  const d = await ok(call('GET', '/api/dashboard', null, T));
  assert.ok(d.stats.monthRevenue > 0);
  assert.ok(d.stats.activeMembers >= 4);
  const rep = await ok(call('GET', '/api/reports/revenue', null, T));
  assert.equal(rep.months.length, 12);
  assert.ok(rep.plans.some((p) => p.planName === '10 堂卡'));
});

test('單堂課編輯與刪除：有人預約不能改時間、有紀錄不能刪；固定課表的課刪除後不會被重新產生', async () => {
  const day = new Date(Date.now() + 8 * H + 5 * D).toISOString().slice(0, 10);
  const s = await ok(call('POST', '/api/sessions', { classTypeId: ct.id, date: day, startTime: '09:00' }, T));
  const moved = await ok(call('PUT', `/api/sessions/${s.id}`, { startTime: '10:30', room: 'B 教室', capacity: 5 }, T));
  assert.equal(new Date(moved.startsAt).toISOString(), new Date(`${day}T10:30:00+08:00`).toISOString());
  assert.equal(moved.room, 'B 教室');
  assert.equal(moved.capacity, 5);
  await ok(book(s.id, members.B.id));
  assert.equal((await call('PUT', `/api/sessions/${s.id}`, { startTime: '11:00' }, T)).status, 400);
  await ok(call('PUT', `/api/sessions/${s.id}`, { note: '帶瑜珈磚' }, T)); // 不改時間的欄位仍可修改
  assert.equal((await call('DELETE', `/api/sessions/${s.id}`, null, T)).status, 400);
  const empty = await ok(call('POST', '/api/sessions', { classTypeId: ct.id, date: day, startTime: '13:00' }, T));
  await ok(call('DELETE', `/api/sessions/${empty.id}`, null, T));
  assert.equal(await prisma.classSession.count({ where: { id: empty.id } }), 0);

  // 固定課表產生的課：刪除後重新排程不會補回
  const wd = new Date(`${day}T12:00:00+08:00`).getUTCDay();
  const tpl = (await ok(call('POST', '/api/templates', { classTypeId: ct.id, weekday: wd, startTime: '18:00' }, T))).template;
  const gen = await prisma.classSession.findFirst({ where: { templateId: tpl.id, startsAt: new Date(`${day}T18:00:00+08:00`) } });
  await ok(call('DELETE', `/api/sessions/${gen.id}`, null, T));
  assert.ok(gen, '固定課表應已產生這堂課');
  await ok(call('POST', '/api/templates/generate', {}, T));
  const week = await ok(call('GET', `/api/sessions?from=${day}&to=${day}`, null, T));
  assert.ok(!week.some((x) => x.id === gen.id));
  assert.equal(await prisma.classSession.count({ where: { templateId: tpl.id, startsAt: gen.startsAt } }), 1);
  await ok(call('DELETE', `/api/templates/${tpl.id}`, null, T));
});

test('銷售紀錄：搜尋、篩選、修改金額、刪除限未使用', async () => {
  const m = await ok(call('POST', '/api/members', { name: '王銷售', phone: '0911000099' }, T));
  const sale = await ok(call('POST', '/api/memberships', { memberId: m.id, planId: pack.id, payMethod: 'TRANSFER', price: 2800 }, T));
  const byName = await ok(call('GET', '/api/reports/sales?q=王銷售', null, T));
  assert.deepEqual(byName.map((x) => x.id), [sale.id]);
  assert.ok((await ok(call('GET', '/api/reports/sales?payMethod=TRANSFER', null, T))).every((x) => x.payMethod === 'TRANSFER'));
  assert.ok((await ok(call('GET', '/api/reports/sales?kind=PERIOD', null, T))).every((x) => x.kind === 'PERIOD'));
  assert.equal((await ok(call('GET', '/api/reports/sales?to=2000-01-01', null, T))).length, 0);
  const edited = await ok(call('PUT', `/api/memberships/${sale.id}`, { price: 2500, payMethod: 'CASH' }, T));
  assert.equal(edited.price, 2500);
  assert.equal(edited.payMethod, 'CASH');
  const used = (await ok(call('GET', '/api/reports/sales', null, T))).find((x) => x.bookingCount > 0);
  assert.equal((await call('DELETE', `/api/memberships/${used.id}`, null, T)).status, 400);
  await ok(call('DELETE', `/api/memberships/${sale.id}`, null, T));
  assert.equal((await ok(call('GET', '/api/reports/sales?q=王銷售', null, T))).length, 0);
  // 其他教室看不到
  assert.equal((await ok(call('GET', '/api/reports/sales', null, T2))).length, 0);
});

test('只開放課表的員工：可搜尋會員、讀取課程類型與教練，但不能修改會員或方案', async () => {
  const staff = await ok(call('POST', '/api/users', { email: 'desk2', password: 'pw-123456', name: '櫃檯二', permissions: ['schedule'] }, T));
  assert.ok(staff.id);
  const S = (await ok(call('POST', '/api/auth/login', { email: 'desk2', password: 'pw-123456' }))).token;
  await ok(call('GET', '/api/studio', null, S));
  await ok(call('GET', '/api/class-types', null, S));
  await ok(call('GET', '/api/coaches', null, S));
  assert.ok((await ok(call('GET', '/api/members?q=會員', null, S))).length > 0);
  assert.equal((await call('GET', `/api/members/${members.A.id}`, null, S)).status, 403);
  assert.equal((await call('POST', '/api/members', { name: 'x', phone: '0900000000' }, S)).status, 403);
  assert.equal((await call('PUT', '/api/studio', { name: 'x' }, S)).status, 403);
  assert.equal((await call('POST', '/api/plans', { name: 'x', kind: 'DROPIN', validDays: 1, price: 1 }, S)).status, 403);
  assert.equal((await call('GET', '/api/reports/sales', null, S)).status, 403);
});

test('通知紀錄可依類型與會員搜尋', async () => {
  const all = await ok(call('GET', '/api/studio/notifications', null, T));
  assert.ok(all.length > 0);
  const kind = all[0].kind;
  assert.ok((await ok(call('GET', `/api/studio/notifications?kind=${kind}`, null, T))).every((l) => l.kind === kind));
  const byMember = await ok(call('GET', `/api/studio/notifications?q=${encodeURIComponent(all[0].memberName)}`, null, T));
  assert.ok(byMember.length > 0 && byMember.every((l) => l.memberName === all[0].memberName || l.message.includes(all[0].memberName)));
  assert.equal((await ok(call('GET', '/api/studio/notifications', null, T2))).length, 0);
});
