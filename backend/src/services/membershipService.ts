// 方案銷售、凍結與到期
import { PayMethod } from '@prisma/client';
import { prisma } from '../app';
import { badRequest, notFound } from '../utils/http';
import { addDays, dateOnly, dateOnlyStr, localDate } from '../utils/time';
import { getStudio } from './studioService';

const daysBetween = (a: string, b: string) => Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400e3);

/** 售出方案：複製方案內容到會員名下，之後修改方案不影響已售出的 */
export async function sellMembership(userId: string, input: {
  memberId: string; planId: string; startDate?: string; price?: number; payMethod?: PayMethod; note?: string;
}) {
  const studio = await getStudio(userId);
  const [member, plan] = await Promise.all([
    prisma.member.findFirst({ where: { id: input.memberId, userId } }),
    prisma.plan.findFirst({ where: { id: input.planId, userId } }),
  ]);
  if (!member) throw notFound('找不到會員');
  if (!plan) throw notFound('找不到方案');
  if (!plan.active) throw badRequest('這個方案已停售');
  const start = input.startDate ?? localDate(new Date(), studio.timezone);
  const credits = plan.kind === 'PERIOD' ? null : plan.credits ?? 1;
  return prisma.membership.create({
    data: {
      userId, memberId: member.id, planId: plan.id, planName: plan.name, kind: plan.kind,
      creditsTotal: credits, creditsLeft: credits, classTypeIds: plan.classTypeIds, dailyLimit: plan.dailyLimit,
      startDate: dateOnly(start), endDate: dateOnly(addDays(start, plan.validDays - 1)),
      price: input.price ?? plan.price, payMethod: input.payMethod ?? 'CASH', note: input.note,
    },
  });
}

/**
 * 凍結（例如出國、受傷）：凍結期間 [from, until] 不能使用，到期日順延同樣天數。
 * 開始日是今天或之前就立即變成凍結中，未來日期由每日排程在當天切換。
 */
export async function freezeMembership(userId: string, id: string, from: string, until: string) {
  const studio = await getStudio(userId);
  const m = await prisma.membership.findFirst({ where: { id, userId } });
  if (!m) throw notFound('找不到方案');
  if (m.status !== 'ACTIVE') throw badRequest('只有使用中的方案可以凍結');
  if (m.frozenFrom) throw badRequest('這個方案已經凍結過，請先解除凍結');
  if (until < from) throw badRequest('凍結結束日不能早於開始日');
  const today = localDate(new Date(), studio.timezone);
  if (from < today) throw badRequest('凍結開始日不能早於今天');
  const days = daysBetween(from, until) + 1;
  return prisma.membership.update({
    where: { id },
    data: {
      frozenFrom: dateOnly(from), frozenUntil: dateOnly(until),
      endDate: dateOnly(addDays(dateOnlyStr(m.endDate), days)),
      status: from <= today ? 'FROZEN' : 'ACTIVE',
    },
  });
}

/** 提前解除凍結：沒用到的凍結天數從到期日扣回 */
export async function unfreezeMembership(userId: string, id: string) {
  const studio = await getStudio(userId);
  const m = await prisma.membership.findFirst({ where: { id, userId } });
  if (!m || !m.frozenFrom || !m.frozenUntil) throw badRequest('這個方案沒有凍結');
  const today = localDate(new Date(), studio.timezone);
  const from = dateOnlyStr(m.frozenFrom), until = dateOnlyStr(m.frozenUntil);
  const unusedFrom = from > today ? from : today; // 今天起算的凍結天數都還沒用到
  const unused = unusedFrom <= until ? daysBetween(unusedFrom, until) + 1 : 0;
  return prisma.membership.update({
    where: { id },
    data: { frozenFrom: null, frozenUntil: null, status: 'ACTIVE', endDate: dateOnly(addDays(dateOnlyStr(m.endDate), -unused)) },
  });
}

/** 每日排程：凍結開始日到了切成凍結、凍結結束切回使用中、過了到期日改為已到期 */
export async function refreshMembershipStatus(now = new Date()) {
  const studios = await prisma.studio.findMany({ select: { userId: true, timezone: true } });
  let frozen = 0, unfrozen = 0, expired = 0;
  for (const s of studios) {
    const today = dateOnly(localDate(now, s.timezone));
    frozen += (await prisma.membership.updateMany({ where: { userId: s.userId, status: 'ACTIVE', frozenFrom: { lte: today }, frozenUntil: { gte: today } }, data: { status: 'FROZEN' } })).count;
    unfrozen += (await prisma.membership.updateMany({ where: { userId: s.userId, status: 'FROZEN', frozenUntil: { lt: today } }, data: { status: 'ACTIVE', frozenFrom: null, frozenUntil: null } })).count;
    expired += (await prisma.membership.updateMany({ where: { userId: s.userId, status: 'ACTIVE', endDate: { lt: today } }, data: { status: 'EXPIRED' } })).count;
  }
  return { frozen, unfrozen, expired };
}
