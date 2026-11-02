// 展示用 demo 教室：課程類型、教練、方案、固定課表、會員與售卡、過去 6 週的上課紀錄與未來的預約。
// 可重複執行（會先清空 demo 帳號的資料）。帳號密碼取自 DEMO_ACCOUNT / DEMO_PASSWORD。執行：npm run db:seed:demo
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PayMethod } from '@prisma/client';
import { prisma } from '../src/app';
import { addDays, dateOnly, localDate, localToUtc, weekdayOf } from '../src/utils/time';
import { generateSessions } from '../src/services/scheduleService';
import { bookSession } from '../src/services/bookingService';

const TZ = 'Asia/Taipei';

// 固定亂數，讓每次產生的資料一致
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

async function main() {
  const account = (process.env.DEMO_ACCOUNT ?? '').trim().toLowerCase();
  const password = process.env.DEMO_PASSWORD ?? '';
  if (!account || !password) throw new Error('請先在 .env 設定 DEMO_ACCOUNT 與 DEMO_PASSWORD');

  const user = await prisma.user.upsert({
    where: { email: account },
    update: { password: await bcrypt.hash(password, 10), active: true },
    create: { email: account, password: await bcrypt.hash(password, 10), name: '晨光瑜珈拳擊工作室', role: 'ADMIN' },
  });
  const userId = user.id;
  // 依外鍵順序清空舊資料
  for (const m of ['order', 'couponRedemption', 'coupon', 'campaign', 'roomBooking', 'room', 'coachAvailability', 'booking', 'reminderLog', 'classSession',
    'membership', 'scheduleTemplate', 'plan', 'member', 'classType', 'coach', 'branch', 'studio'] as const) {
    await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { userId } });
  }
  await prisma.studio.create({
    data: {
      userId, name: '晨光瑜珈拳擊工作室', phone: '02-2345-6789', address: '台北市大安區復興南路一段 100 號 3 樓', timezone: TZ,
      onlinePayEnabled: true, transferEnabled: true, bankInfo: '台灣銀行（004）\n帳號 123-456-789012\n戶名 晨光瑜珈拳擊工作室',
      referralRewardAmount: 300, noShowLimit: 3, noShowWindowDays: 30, noShowSuspendDays: 7,
      terms: '一、預約與取消\n1. 開課前 12 小時以前取消，堂數全額退回；之後取消視為晚取消，扣除堂數。\n2. 未到課且未取消者扣除堂數；30 天內未到 3 次，暫停線上預約 7 天。\n\n二、方案效期\n方案須於效期內使用完畢，出國或受傷可申請凍結。\n\n三、健康聲明\n本人確認身體狀況適合參加課程，如有傷病將事先告知教練。',
      termsVersion: 1,
    },
  });

  const types = Object.fromEntries(await Promise.all(([
    ['哈達瑜珈', '#4f9d69', 60, 14, 1], ['流動瑜珈', '#0f9d9a', 60, 14, 1], ['空中瑜珈', '#7c5cc4', 75, 8, 2],
    ['拳擊有氧', '#d9573b', 60, 16, 1], ['街舞入門', '#e8a33d', 60, 18, 1],
  ] as const).map(async ([name, color, durationMin, defaultCapacity, creditCost]) =>
    [name, await prisma.classType.create({ data: { userId, name, color, durationMin, defaultCapacity, creditCost } })])));
  await prisma.classType.create({ data: { userId, name: '私人教練課', color: '#c45c9a', durationMin: 60, defaultCapacity: 1, creditCost: 2, isPrivate: true } });

  const coaches = Object.fromEntries(await Promise.all(([
    ['Mia', '#7c5cc4'], ['阿傑', '#d9573b'], ['小芸', '#4f9d69'], ['Ken', '#e8a33d'],
  ] as const).map(async ([name, color], i) => [name, await prisma.coach.create({
    data: { userId, name, color, payPerClass: [900, 800, 800, 700][i], payPerHead: 50, headThreshold: 8, revenueShare: i === 0 ? 10 : 0 },
  })])));
  // 私人課可預約時段：阿傑週一三五下午、Mia 週二四早上
  await prisma.coachAvailability.createMany({ data: [
    ...[1, 3, 5].map((weekday) => ({ userId, coachId: coaches['阿傑'].id, weekday, startTime: '14:00', endTime: '18:00' })),
    ...[2, 4].map((weekday) => ({ userId, coachId: coaches['Mia'].id, weekday, startTime: '09:00', endTime: '12:00' })),
  ] });

  const plans = await Promise.all([
    { name: '單堂體驗', kind: 'DROPIN' as const, credits: 1, validDays: 30, price: 450, onlineSale: true, trialOnly: true, description: '第一次來上課的朋友限定' },
    { name: '10 堂卡', kind: 'PACK' as const, credits: 10, validDays: 90, price: 3800, onlineSale: true, description: '適合每週 1～2 堂，可上所有團體課' },
    { name: '20 堂卡', kind: 'PACK' as const, credits: 20, validDays: 180, price: 6800, onlineSale: true },
    { name: '月卡（不限堂數）', kind: 'PERIOD' as const, credits: null, validDays: 30, price: 3200, dailyLimit: 2, onlineSale: true },
    { name: '拳擊 8 堂卡', kind: 'PACK' as const, credits: 8, validDays: 60, price: 2800, classTypeIds: [types['拳擊有氧'].id] },
  ].map((p) => prisma.plan.create({ data: { userId, ...p } })));

  // [星期, 時間, 課程, 教練, 教室]
  const week: [number, string, string, string, string][] = [
    [1, '07:00', '流動瑜珈', '小芸', 'A 教室'], [1, '19:30', '拳擊有氧', '阿傑', 'B 教室'],
    [2, '12:15', '哈達瑜珈', '小芸', 'A 教室'], [2, '19:00', '空中瑜珈', 'Mia', 'A 教室'], [2, '20:30', '街舞入門', 'Ken', 'B 教室'],
    [3, '07:00', '流動瑜珈', '小芸', 'A 教室'], [3, '19:30', '拳擊有氧', '阿傑', 'B 教室'],
    [4, '12:15', '哈達瑜珈', 'Mia', 'A 教室'], [4, '19:00', '空中瑜珈', 'Mia', 'A 教室'], [4, '20:30', '街舞入門', 'Ken', 'B 教室'],
    [5, '19:00', '拳擊有氧', '阿傑', 'B 教室'], [5, '19:30', '哈達瑜珈', '小芸', 'A 教室'],
    [6, '10:00', '流動瑜珈', 'Mia', 'A 教室'], [6, '11:00', '拳擊有氧', '阿傑', 'B 教室'], [6, '14:00', '街舞入門', 'Ken', 'B 教室'],
    [0, '10:00', '哈達瑜珈', '小芸', 'A 教室'],
  ];
  const today = localDate(new Date(), TZ);
  const templates = await Promise.all(week.map(([weekday, startTime, t, c, room]) => prisma.scheduleTemplate.create({
    data: { userId, weekday, startTime, classTypeId: types[t].id, coachId: coaches[c].id, room, durationMin: types[t].durationMin, capacity: types[t].defaultCapacity, activeFrom: dateOnly(addDays(today, -60)) },
  })));

  const names = ['王小明', '林怡君', '陳雅婷', '張家豪', '李佩珊', '黃志偉', '吳欣怡', '劉俊傑', '蔡宜芳', '楊淑芬', '許文彬', '鄭雅雯',
    '謝孟哲', '郭佳穎', '洪嘉玲', '曾柏翰', '邱詩涵', '廖子軒', '賴思妤', '周冠宇', '徐筱涵', '蘇建宏', '葉品妤', '莊承恩'];
  const members = await Promise.all(names.map((name, i) => prisma.member.create({
    data: {
      userId, name, phone: `09${String(12345678 + i * 1379).padStart(8, '0')}`,
      note: i === 2 ? '右膝舊傷，避免深蹲跳躍' : i === 7 ? '孕期 20 週，空中瑜珈請先詢問' : null,
      status: i === 23 ? 'INACTIVE' : 'ACTIVE',
    },
  })));

  // 售卡：過去 12 個月的歷史銷售（已到期）＋目前有效的方案
  const methods: PayMethod[] = ['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'CASH', 'TRANSFER'];
  for (let mo = 11; mo >= 2; mo--) {
    const n = 4 + Math.floor(rand() * 6) + (11 - mo);
    for (let k = 0; k < n; k++) {
      const plan = pick(plans);
      const start = addDays(today, -mo * 30 - Math.floor(rand() * 25));
      await prisma.membership.create({
        data: {
          userId, memberId: pick(members).id, planId: plan.id, planName: plan.name, kind: plan.kind, creditsTotal: plan.credits,
          creditsLeft: plan.kind === 'PERIOD' ? null : 0, classTypeIds: plan.classTypeIds, dailyLimit: plan.dailyLimit,
          startDate: dateOnly(start), endDate: dateOnly(addDays(start, plan.validDays - 1)), status: 'EXPIRED',
          price: plan.price, payMethod: pick(methods), paidAt: localToUtc(start, '15:00', TZ),
        },
      });
    }
  }
  // 目前有效的方案：先建立，堂數在排完過去的上課紀錄後再依實際使用量回填
  type Pass = { id: string; memberId: string; start: string; credits: number | null; classTypeIds: string[]; used: number; reserve: number };
  const passes: Pass[] = [];
  for (const [i, m] of members.entries()) {
    if (m.status === 'INACTIVE' || i === 21) continue; // 留一位沒有方案的會員
    const plan = i % 5 === 0 ? plans[3] : i % 7 === 0 ? plans[4] : i % 3 === 0 ? plans[2] : plans[1];
    const start = addDays(today, -1 - Math.floor(rand() * (plan.kind === 'PERIOD' ? 25 : 35)));
    const ms = await prisma.membership.create({
      data: {
        userId, memberId: m.id, planId: plan.id, planName: plan.name, kind: plan.kind, creditsTotal: plan.credits, creditsLeft: plan.credits,
        classTypeIds: plan.classTypeIds, dailyLimit: plan.dailyLimit, startDate: dateOnly(start),
        endDate: dateOnly(i === 1 || i === 6 ? addDays(today, 4) : addDays(start, plan.validDays - 1)),
        price: i === 12 ? plan.price - 300 : plan.price, payMethod: pick(methods),
        paidAt: i === 12 || i === 15 ? new Date() : localToUtc(start, '18:00', TZ), // 兩筆今天售出，本月營收不為 0
        note: i === 12 ? '舊生續約優惠' : null,
      },
    });
    // i=4、9 示範「堂數快用完」：保留 2 堂；其餘隨機保留 3～8 成，未來預約後仍有剩
    passes.push({ id: ms.id, memberId: m.id, start, credits: plan.credits, classTypeIds: plan.classTypeIds, used: 0, reserve: i === 4 || i === 9 ? 2 : Math.max(6, Math.round((plan.credits ?? 0) * (0.3 + rand() * 0.5))) });
  }

  const costOf: Record<string, number> = Object.fromEntries((await prisma.classType.findMany({ where: { userId } })).map((x) => [x.id, x.creditCost]));
  // 過去 6 週（含今天已開始）的課程與出席紀錄：只排方案涵蓋、課程類型允許、堂數足夠的會員
  const now = new Date();
  for (let d = -42; d <= 0; d++) {
    const day = addDays(today, d);
    for (const t of templates.filter((x) => x.weekday === weekdayOf(day))) {
      const startsAt = localToUtc(day, t.startTime, TZ);
      if (startsAt > now) continue;
      const s = await prisma.classSession.create({
        data: { userId, classTypeId: t.classTypeId, coachId: t.coachId, templateId: t.id, room: t.room, startsAt, endsAt: new Date(startsAt.getTime() + t.durationMin * 60e3), capacity: t.capacity },
      });
      const cost = costOf[t.classTypeId];
      const ok = passes.filter((p) => p.start <= day && (!p.classTypeIds.length || p.classTypeIds.includes(t.classTypeId))
        && (p.credits === null || p.used + cost <= p.credits - p.reserve));
      const who = ok.sort(() => rand() - 0.5).slice(0, Math.floor(t.capacity * (0.45 + rand() * 0.5)));
      const rows = who.map((p) => {
        const r = rand();
        const status = r < 0.86 ? 'ATTENDED' as const : r < 0.94 ? 'NO_SHOW' as const : 'LATE_CANCELLED' as const;
        if (p.credits !== null) p.used += cost;
        return { userId, sessionId: s.id, memberId: p.memberId, membershipId: p.id, status, creditsCharged: p.credits === null ? 0 : cost, source: rand() < 0.6 ? 'MEMBER' as const : 'STAFF' as const, bookedAt: new Date(startsAt.getTime() - 86400e3), checkedInAt: status === 'ATTENDED' ? startsAt : null };
      });
      if (rows.length) await prisma.booking.createMany({ data: rows });
    }
  }
  for (const p of passes) {
    if (p.credits !== null) await prisma.membership.update({ where: { id: p.id }, data: { creditsLeft: p.credits - p.used } });
  }
  const withPass = members.filter((m) => passes.some((p) => p.memberId === m.id));

  // 未來課程與預約（透過預約服務，堂數與候補規則照實際邏輯計算）
  await generateSessions(userId);
  const upcoming = await prisma.classSession.findMany({ where: { userId, startsAt: { gt: new Date() } }, include: { classType: true }, orderBy: { startsAt: 'asc' } });
  const futureCount: Record<string, number> = {}; // 每位會員最多 4 筆未來預約
  for (const [idx, s] of upcoming.entries()) {
    const fill = idx < 6 ? 0.7 + rand() * 0.45 : Math.max(0.05, 0.6 - idx * 0.02 + rand() * 0.25);
    const want = Math.round(s.capacity * fill) + (idx === 1 ? 3 : 0); // 第二堂刻意超額，示範候補
    const pool = withPass.filter((x) => x.id !== members[4].id && x.id !== members[9].id && (futureCount[x.id] ?? 0) < 4);
    for (const m of pool.sort(() => rand() - 0.5).slice(0, want)) {
      futureCount[m.id] = (futureCount[m.id] ?? 0) + 1;
      await bookSession({ userId, sessionId: s.id, memberId: m.id, source: rand() < 0.6 ? 'MEMBER' : 'STAFF' }).catch(() => undefined);
    }
  }

  // 行銷、訂單、場地示範資料
  await prisma.coupon.createMany({ data: [
    { userId, code: 'OPEN500', name: '週年慶折 500', discountType: 'AMOUNT', value: 500, minAmount: 3000, maxUses: 50, usedCount: 6 },
    { userId, code: 'BACK90', name: '老學員回流九折', discountType: 'PERCENT', value: 10 },
    { userId, code: 'NEW100', name: '新朋友首購折 100', discountType: 'AMOUNT', value: 100, newMemberOnly: true },
  ] });
  await prisma.member.update({ where: { id: members[0].id }, data: { referralCode: 'RDEMO1' } });
  await prisma.member.updateMany({ where: { id: { in: [members[13].id, members[17].id] } }, data: { referredById: members[0].id } });
  await prisma.order.create({ data: {
    userId, memberId: members[5].id, planId: plans[1].id, tradeNo: `SMDEMO${Date.now().toString(36).toUpperCase()}`.slice(0, 20), method: 'TRANSFER',
    originalAmount: 3800, amount: 3800, transferLast5: '83021', transferAt: new Date(),
  } });
  const roomA = await prisma.room.create({ data: { userId, name: 'A 教室', hourlyRate: 600, capacity: 15, note: '含音響、瑜珈墊 15 張' } });
  await prisma.room.create({ data: { userId, name: 'B 教室', hourlyRate: 800, capacity: 20 } });
  const rentDay = addDays(today, 5);
  await prisma.roomBooking.create({ data: {
    userId, roomId: roomA.id, renterName: '林老師（頌缽工作坊）', renterPhone: '0933-222-111', startsAt: localToUtc(rentDay, '14:00', TZ), endsAt: localToUtc(rentDay, '17:00', TZ),
    price: 1800, paid: true, payMethod: 'TRANSFER',
  } });

  const counts = await Promise.all([prisma.member.count({ where: { userId } }), prisma.classSession.count({ where: { userId } }), prisma.booking.count({ where: { userId } })]);
  console.log(`demo 教室已建立：帳號 ${account}，會員 ${counts[0]}、課程 ${counts[1]}、預約 ${counts[2]}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
