import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config';

const publicUser = {
  id: true, email: true, name: true, role: true, permissions: true, ownerId: true, createdAt: true,
} as const;

/** 登入帳號統一去空白、轉小寫，避免大小寫不同被當成兩個帳號 */
export const normalizeAccount = (v: unknown) => String(v ?? '').trim().toLowerCase();

function sign(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '30d' });
}

// 登入失敗次數限制：同一 IP＋帳號 15 分鐘內錯 8 次就暫時鎖住，擋暴力猜密碼。
// 存在記憶體即可（重啟歸零無妨），不需要資料表。
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const loginFails = new Map<string, { count: number; first: number }>();

function tooManyFails(key: string) {
  const f = loginFails.get(key);
  if (!f) return false;
  if (Date.now() - f.first > LOGIN_WINDOW_MS) { loginFails.delete(key); return false; }
  return f.count >= LOGIN_MAX_FAILS;
}

function recordFail(key: string) {
  const f = loginFails.get(key);
  if (!f || Date.now() - f.first > LOGIN_WINDOW_MS) loginFails.set(key, { count: 1, first: Date.now() });
  else f.count += 1;
}

export async function register(req: Request, res: Response) {
  // 正式環境預設不開放自行註冊；需要時在 .env 設 ALLOW_REGISTER=true
  if (process.env.ALLOW_REGISTER !== 'true') {
    res.status(403).json({ error: '目前不開放自行註冊，請聯絡管理員建立帳號' });
    return;
  }
  const { password, name } = req.body;
  const email = normalizeAccount(req.body.email);
  if (!email || !password || !name) {
    res.status(400).json({ error: '請填寫所有欄位' });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: '此帳號已被使用' });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, password: hash, name }, select: publicUser });
  res.json({ token: sign(user.id), user });
}

export async function login(req: Request, res: Response) {
  const { password } = req.body;
  const account = normalizeAccount(req.body.email ?? req.body.account);
  const failKey = `${req.ip}|${account}`;
  if (tooManyFails(failKey)) {
    res.status(429).json({ error: '密碼錯誤次數過多，請 15 分鐘後再試' });
    return;
  }
  const user = await prisma.user.findFirst({ where: { email: { equals: account, mode: 'insensitive' } } });
  if (!user || !(await bcrypt.compare(String(password ?? ''), user.password))) {
    recordFail(failKey);
    res.status(401).json({ error: '帳號或密碼錯誤' });
    return;
  }
  loginFails.delete(failKey);
  if (!user.active) {
    res.status(403).json({ error: '此帳號已停用，請聯絡管理員' });
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const { password: _pw, ...rest } = user;
  res.json({ token: sign(user.id), user: rest });
}

export async function me(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.authUserId! }, select: publicUser });
  res.json(user);
}

/** 修改自己的登入帳號、名稱或密碼（需驗證目前密碼） */
/** 登入頁用：回傳公開的示範帳號，未設定則回 null */
export function demoAccount(_req: Request, res: Response) {
  res.json(config.demo.enabled ? { account: config.demo.account, password: config.demo.password } : null);
}

export async function updateMe(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.authUserId! } });
  if (!user) { res.status(404).json({ error: '找不到帳號' }); return; }

  const { name, currentPassword, newPassword } = req.body;
  const account = req.body.email !== undefined ? normalizeAccount(req.body.email) : undefined;
  const changingCredentials = (account && account !== user.email) || newPassword;
  // 示範帳密公開在登入頁，被改掉其他訪客就登不進來
  if (changingCredentials && config.demo.enabled && user.email === config.demo.account) {
    res.status(403).json({ error: '示範帳號不能修改帳號或密碼' });
    return;
  }
  if (changingCredentials && !(await bcrypt.compare(String(currentPassword ?? ''), user.password))) {
    res.status(400).json({ error: '目前密碼不正確' });
    return;
  }
  if (account !== undefined) {
    if (account.length < 3) { res.status(400).json({ error: '帳號至少 3 個字' }); return; }
    const taken = await prisma.user.findFirst({ where: { email: { equals: account, mode: 'insensitive' }, id: { not: user.id } } });
    if (taken) { res.status(409).json({ error: '此帳號已被使用' }); return; }
  }
  if (newPassword && String(newPassword).length < 6) {
    res.status(400).json({ error: '新密碼至少 6 碼' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: name || undefined,
      email: account || undefined,
      password: newPassword ? await bcrypt.hash(String(newPassword), 10) : undefined,
    },
    select: publicUser,
  });
  res.json(updated);
}
