// 帳號權限管理：管理員建立員工帳號（自訂帳號＋密碼），並指定可使用的模組。
import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../app';
import { MODULES, sanitizePermissions } from '../middleware/permissions';
import { normalizeAccount } from './authController';

const userSelect = {
  id: true, email: true, name: true, role: true, permissions: true, active: true, lastLoginAt: true, createdAt: true,
} as const;

async function accountTaken(account: string, exceptId?: string) {
  return prisma.user.findFirst({
    where: { email: { equals: account, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
}

export function listModules(_req: AuthRequest, res: Response) {
  res.json(MODULES);
}

export async function listUsers(req: AuthRequest, res: Response) {
  const [self, staff] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.authUserId! }, select: userSelect }),
    prisma.user.findMany({ where: { ownerId: req.authUserId! }, select: userSelect, orderBy: { createdAt: 'asc' } }),
  ]);
  res.json({ self, staff });
}

export async function createUser(req: AuthRequest, res: Response) {
  const account = normalizeAccount(req.body.email ?? req.body.account);
  const { password, name, permissions } = req.body;
  if (!account || !password || !name) {
    res.status(400).json({ error: '請填寫帳號、密碼與姓名' });
    return;
  }
  if (account.length < 3) { res.status(400).json({ error: '帳號至少 3 個字' }); return; }
  if (String(password).length < 6) { res.status(400).json({ error: '密碼至少 6 碼' }); return; }
  if (await accountTaken(account)) { res.status(409).json({ error: '此帳號已被使用' }); return; }

  const user = await prisma.user.create({
    data: {
      email: account,
      password: await bcrypt.hash(String(password), 10),
      name,
      role: 'STAFF',
      ownerId: req.authUserId!,
      permissions: sanitizePermissions(permissions),
    },
    select: userSelect,
  });
  res.status(201).json(user);
}

/** 編輯員工：帳號、姓名、權限、啟用狀態、重設密碼 */
export async function updateUser(req: AuthRequest, res: Response) {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, ownerId: req.authUserId! } });
  if (!target) { res.status(404).json({ error: '找不到帳號' }); return; }

  const { name, permissions, password, active } = req.body;
  const account = req.body.email !== undefined ? normalizeAccount(req.body.email) : undefined;
  if (account !== undefined) {
    if (account.length < 3) { res.status(400).json({ error: '帳號至少 3 個字' }); return; }
    if (await accountTaken(account, target.id)) { res.status(409).json({ error: '此帳號已被使用' }); return; }
  }
  if (password && String(password).length < 6) { res.status(400).json({ error: '密碼至少 6 碼' }); return; }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      email: account || undefined,
      name: name || undefined,
      permissions: permissions !== undefined ? sanitizePermissions(permissions) : undefined,
      active: typeof active === 'boolean' ? active : undefined,
      password: password ? await bcrypt.hash(String(password), 10) : undefined,
    },
    select: userSelect,
  });
  res.json(updated);
}

export async function deleteUser(req: AuthRequest, res: Response) {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, ownerId: req.authUserId! } });
  if (!target) { res.status(404).json({ error: '找不到帳號' }); return; }
  await prisma.user.delete({ where: { id: target.id } });
  res.json({ ok: true });
}
