// 自動行銷與提醒：生日祝福（可附折價券）、久未到訪喚回、置物櫃到期、下課滿意度問卷邀請。
// 每則訊息以 ReminderLog 的唯一鍵去重（見 lineService），排程重跑不會重複發送或重複發券。
import crypto from 'crypto';
import { Studio } from '@prisma/client';
import { prisma } from '../app';
import { addDays, dateOnly, dateOnlyStr, localDate } from '../utils/time';
import { notifyMember } from './lineService';

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+|[^{}]+)\}/g, (k, n) => vars[n] ?? k);

/** 發一張會員專屬折價券（限用一次，有效 days 天） */
async function personalCoupon(st: Studio, memberId: string, name: string, amount: number, today: string, days: number) {
  return prisma.coupon.create({
    data: {
      userId: st.userId, code: `${name === '生日禮' ? 'BD' : 'WB'}${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      name, discountType: 'AMOUNT', value: amount, memberId, perMemberLimit: 1, maxUses: 1, validTo: dateOnly(addDays(today, days)),
    },
  });
}

/**
 * 先占用通知紀錄再發券：同一件事（例如今年生日）只會處理一次。
 * 沙盒模式也會建立折價券（後台看得到），正式模式下沒綁定 LINE 的會員略過。
 */
async function sendOnce(st: Studio, memberId: string, kind: 'BIRTHDAY' | 'WINBACK', refId: string, build: (code: string | null) => string, coupon?: () => Promise<{ code: string }>) {
  const exists = await prisma.reminderLog.count({ where: { kind, refId, memberId } });
  if (exists) return false;
  const c = coupon ? await coupon() : null;
  const r = await notifyMember(st.userId, memberId, kind, refId, build(c?.code ?? null));
  if (c && r !== 'sent' && r !== 'sandbox') await prisma.coupon.delete({ where: { userId_code: { userId: st.userId, code: c.code } } }).catch(() => undefined);
  return r === 'sent' || r === 'sandbox';
}

export async function runAutomations(now = new Date()) {
  const studios = await prisma.studio.findMany();
  const out = { birthday: 0, winback: 0, locker: 0, survey: 0 };
  for (const st of studios) {
    const today = localDate(now, st.timezone);

    if (st.birthdayEnabled) {
      const md = today.slice(5);
      const members = await prisma.member.findMany({ where: { userId: st.userId, status: 'ACTIVE', birthday: { not: null } }, select: { id: true, name: true, birthday: true } });
      for (const m of members.filter((x) => dateOnlyStr(x.birthday!).slice(5) === md)) {
        const tpl = st.birthdayMessage || '{name} 生日快樂！{studio} 祝您新的一歲健康有活力。';
        const ok = await sendOnce(st, m.id, 'BIRTHDAY', today.slice(0, 4),
          (code) => fill(tpl, { name: m.name, studio: st.name }) + (code ? `\n送您 NT$${st.birthdayCoupon} 生日折價券，代碼 ${code}，30 天內購買方案時使用。` : ''),
          st.birthdayCoupon > 0 ? () => personalCoupon(st, m.id, '生日禮', st.birthdayCoupon, today, 30) : undefined);
        if (ok) out.birthday++;
      }
    }

    if (st.winbackEnabled && st.winbackDays > 0) {
      // 曾經上過課、最近 winbackDays 天沒有來的使用中會員；以最後一次出席的預約為單位，回來上課後再久未到訪會再發一次
      const cutoff = new Date(now.getTime() - st.winbackDays * 86400e3);
      const members = await prisma.member.findMany({
        where: { userId: st.userId, status: 'ACTIVE', bookings: { some: { status: 'ATTENDED' } } },
        select: { id: true, name: true, bookings: { where: { status: 'ATTENDED' }, select: { id: true, session: { select: { startsAt: true } } }, orderBy: { session: { startsAt: 'desc' } }, take: 1 } },
      });
      for (const m of members) {
        const last = m.bookings[0];
        if (!last || last.session.startsAt >= cutoff) continue;
        // 已經很久（超過三倍天數）沒來的不再打擾
        if (last.session.startsAt < new Date(now.getTime() - st.winbackDays * 3 * 86400e3)) continue;
        const tpl = st.winbackMessage || '{name} 好久不見！{studio} 想念您，最近有新課程，歡迎回來上課。';
        const ok = await sendOnce(st, m.id, 'WINBACK', last.id,
          (code) => fill(tpl, { name: m.name, studio: st.name }) + (code ? `\n回來上課送您 NT$${st.winbackCoupon} 折價券，代碼 ${code}，14 天內有效。` : ''),
          st.winbackCoupon > 0 ? () => personalCoupon(st, m.id, '回娘家禮', st.winbackCoupon, today, 14) : undefined);
        if (ok) out.winback++;
      }
    }

    // 置物櫃 3 天內到期提醒
    const rentals = await prisma.lockerRental.findMany({
      where: { userId: st.userId, status: 'ACTIVE', endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, 3)) } }, include: { locker: true },
    });
    for (const r of rentals) {
      const res = await notifyMember(st.userId, r.memberId, 'LOCKER_EXPIRY', r.id, `【${st.name}】置物櫃 ${r.locker.code} 將於 ${dateOnlyStr(r.endDate)} 到期，續租請洽櫃檯，未續租請於到期前清空。`);
      if (res === 'sent' || res === 'sandbox') out.locker++;
    }
  }
  return out;
}

/** 下課後 30 分鐘到 3 小時：邀請出席的會員填寫下課問卷（每堂課每人一次） */
export async function inviteAfterClassSurveys(now = new Date()) {
  const surveys = await prisma.survey.findMany({ where: { active: true, afterClass: true } });
  let sent = 0;
  for (const s of surveys) {
    const st = await prisma.studio.findUnique({ where: { userId: s.userId } });
    if (!st) continue;
    const bookings = await prisma.booking.findMany({
      where: { userId: s.userId, status: 'ATTENDED', session: { endsAt: { lte: new Date(now.getTime() - 30 * 60e3), gte: new Date(now.getTime() - 3 * 3600e3) } } },
      include: { session: { include: { classType: true } } },
    });
    for (const b of bookings) {
      const r = await notifyMember(s.userId, b.memberId, 'SURVEY', `${s.id}:${b.sessionId}`,
        `【${st.name}】感謝您今天參加 ${b.session.classType.name}！花 30 秒告訴我們上課感受：到會員專區「我的」→「問卷」填寫。`);
      if (r === 'sent' || r === 'sandbox') sent++;
    }
  }
  return { sent };
}
