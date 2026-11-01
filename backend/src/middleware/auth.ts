import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../app';
import { moduleForPath } from './permissions';

export interface AuthRequest extends Request {
  /** 資料擁有者 id（員工 = 所屬管理員；管理員 = 自己）。所有資料查詢都以此為範圍。 */
  userId?: string;
  /** 實際登入的帳號 id */
  authUserId?: string;
  role?: 'ADMIN' | 'STAFF';
  permissions?: string[];
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  let payload: { userId?: string };
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId?: string };
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  if (!payload.userId) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, ownerId: true, permissions: true, active: true },
  });
  if (!user || !user.active) {
    res.status(401).json({ error: user ? '此帳號已停用' : 'Invalid token' });
    return;
  }

  req.authUserId = user.id;
  req.userId = user.role === 'STAFF' && user.ownerId ? user.ownerId : user.id;
  req.role = user.role;
  req.permissions = user.permissions;

  if (user.role === 'STAFF') {
    const module = moduleForPath(req.path, req.method);
    if (module && !user.permissions.includes(module)) {
      res.status(403).json({ error: '您沒有使用此功能的權限，請聯絡管理員' });
      return;
    }
  }
  next();
}

/** 僅限管理員（帳號管理） */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.role !== 'ADMIN') {
    res.status(403).json({ error: '僅管理員可執行此操作' });
    return;
  }
  next();
}
