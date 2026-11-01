import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface MemberRequest extends Request {
  memberId?: string;
}

// 會員端 JWT 與教室端分開：payload 帶 kind='member'，避免教室 token 能存取會員 API（反之亦然）。
export function requireMember(req: MemberRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { memberId: string; kind: string };
    if (payload.kind !== 'member') {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.memberId = payload.memberId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function signMemberToken(memberId: string): string {
  return jwt.sign({ memberId, kind: 'member' }, config.jwtSecret, { expiresIn: '60d' });
}
