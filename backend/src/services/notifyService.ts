// 即時通知：候補遞補成功、教室取消課程。訊息在交易完成後才送出，送出失敗不影響預約結果
import { Booking } from '@prisma/client';
import { prisma } from '../app';
import { formatLocal } from '../utils/time';
import { getStudio } from './studioService';
import { notifyMember } from './lineService';

export async function notifyBookingChanges(userId: string, promoted: Booking[]) {
  if (!promoted.length) return;
  const studio = await getStudio(userId);
  for (const b of promoted) {
    const s = await prisma.classSession.findUnique({ where: { id: b.sessionId }, include: { classType: true } });
    if (!s) continue;
    const text = `【${studio.name}】候補成功！\n您已遞補上 ${formatLocal(s.startsAt, studio.timezone)} 的 ${s.classType.name}${b.creditsCharged ? `，已扣 ${b.creditsCharged} 堂` : ''}。\n不克前來請提早取消。`;
    await notifyMember(userId, b.memberId, 'PROMOTED', b.id, text).catch((e) => console.error('notify promoted', e));
  }
}

export async function notifySessionCancelled(userId: string, sessionId: string, affected: Booking[], reason?: string) {
  if (!affected.length) return;
  const studio = await getStudio(userId);
  const s = await prisma.classSession.findUnique({ where: { id: sessionId }, include: { classType: true } });
  if (!s) return;
  for (const b of affected) {
    const text = `【${studio.name}】課程取消通知\n很抱歉，${formatLocal(s.startsAt, studio.timezone)} 的 ${s.classType.name} 已取消${reason ? `（${reason}）` : ''}。${b.status === 'BOOKED' && b.creditsCharged ? `\n已退回 ${b.creditsCharged} 堂。` : ''}`;
    await notifyMember(userId, b.memberId, 'SESSION_CANCELLED', b.id, text).catch((e) => console.error('notify cancelled', e));
  }
}
