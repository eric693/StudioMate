import { User } from '../types';

/** 前端路由 → 模組鍵（對應後端 middleware/permissions.ts） */
const ROUTE_MODULES: [RegExp, string][] = [
  [/^\/$/, 'dashboard'],
  [/^\/(schedule|templates|checkin-display)/, 'schedule'],
  [/^\/(members|orders)/, 'members'],
  [/^\/marketing/, 'marketing'],
  [/^\/rentals/, 'rentals'],
  [/^\/catalog/, 'catalog'],
  [/^\/reports/, 'reports'],
  [/^\/settings/, 'settings'],
];

export const isAdmin = (user: User | null) => !!user && user.role !== 'STAFF';

export function can(user: User | null, module: string) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return (user.permissions ?? []).includes(module);
}

export function moduleOfRoute(path: string): string | null {
  for (const [re, key] of ROUTE_MODULES) if (re.test(path)) return key;
  return null;
}

export function canRoute(user: User | null, path: string) {
  if (path.startsWith('/accounts')) return !!user; // 自己的帳號設定人人可進，員工管理區塊另外判斷
  const m = moduleOfRoute(path);
  return m ? can(user, m) : true;
}

/** 員工登入後第一個可以進的頁面 */
export function firstAllowedRoute(user: User | null) {
  const order = ['/', '/schedule', '/members', '/orders', '/catalog', '/marketing', '/rentals', '/reports', '/settings'];
  return order.find((p) => canRoute(user, p)) ?? '/accounts';
}
