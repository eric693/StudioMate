// 教室資料與營運規則：第一次使用時依帳號名稱建立預設值
import { Studio } from '@prisma/client';
import { prisma } from '../app';

export async function getStudio(userId: string): Promise<Studio> {
  const found = await prisma.studio.findUnique({ where: { userId } });
  if (found) return found;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  return prisma.studio.upsert({ where: { userId }, update: {}, create: { userId, name: user.name } });
}
