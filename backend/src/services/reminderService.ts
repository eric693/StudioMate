// 排程提醒：上課前提醒、方案即將到期、剩餘堂數偏低。每件事只會通知一次（見 lineService 的去重）
import { prisma } from '../app';
import { addDays, dateOnly, dateOnlyStr, formatLocal, localDate } from '../utils/time';
import { notifyMember } from './lineService';

export async function runReminders(now = new Date()) {
  const studios = await prisma.studio.findMany();
  const out = { classes: 0, expiry: 0, lowCredit: 0 };
  for (const st of studios) {
    // 上課前提醒
    const upcoming = await prisma.booking.findMany({
      where: {
        userId: st.userId, status: 'BOOKED',
        session: { status: 'SCHEDULED', startsAt: { gt: now, lte: new Date(now.getTime() + st.remindBeforeHours * 3600e3) } },
      },
      include: { session: { include: { classType: true, coach: true } } },
    });
    for (const b of upcoming) {
      const s = b.session;
      const text = `【${st.name}】上課提醒\n${formatLocal(s.startsAt, st.timezone)} ${s.classType.name}${s.coach ? `（${s.coach.name}）` : ''}${s.room ? `\n教室：${s.room}` : ''}\n不克前來請提早取消，開課前 ${st.cancelDeadlineHours} 小時內取消將${st.lateCancelForfeit ? '扣除堂數' : '視為晚取消'}。`;
      if (['sent', 'sandbox'].includes(await notifyMember(st.userId, b.memberId, 'CLASS', b.id, text))) out.classes++;
    }

    // 方案即將到期（只提醒還有剩餘堂數或期限卡的）
    const today = localDate(now, st.timezone);
    const expiring = await prisma.membership.findMany({
      where: { userId: st.userId, status: 'ACTIVE', endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, st.expiryRemindDays)) } },
    });
    for (const m of expiring) {
      if (m.kind !== 'PERIOD' && (m.creditsLeft ?? 0) <= 0) continue;
      const left = m.kind === 'PERIOD' ? '' : `，還剩 ${m.creditsLeft} 堂`;
      const text = `【${st.name}】方案到期提醒\n您的「${m.planName}」將於 ${dateOnlyStr(m.endDate)} 到期${left}，記得把握時間上課，續約請洽櫃檯。`;
      if (['sent', 'sandbox'].includes(await notifyMember(st.userId, m.memberId, 'EXPIRY', m.id, text))) out.expiry++;
    }

    // 剩餘堂數偏低
    const low = await prisma.membership.findMany({
      where: { userId: st.userId, status: 'ACTIVE', kind: 'PACK', creditsLeft: { gt: 0, lte: st.lowCreditThreshold }, endDate: { gte: dateOnly(today) } },
    });
    for (const m of low) {
      const text = `【${st.name}】堂數提醒\n您的「${m.planName}」剩下 ${m.creditsLeft} 堂（${dateOnlyStr(m.endDate)} 到期），需要續購請洽櫃檯。`;
      if (['sent', 'sandbox'].includes(await notifyMember(st.userId, m.memberId, 'LOW_CREDIT', m.id, text))) out.lowCredit++;
    }
  }
  return out;
}
