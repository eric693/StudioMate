// 模組權限：員工（STAFF）只能呼叫有權限模組的 API。管理員不受限。

export const MODULES = [
  { key: 'dashboard', label: '總覽' },
  { key: 'schedule', label: '課表、點名與預約' },
  { key: 'members', label: '會員與售卡' },
  { key: 'catalog', label: '方案、課程類型與教練' },
  { key: 'reports', label: '營收報表' },
  { key: 'settings', label: '教室設定（規則、LINE）' },
] as const;

export const MODULE_KEYS: string[] = MODULES.map((m) => m.key);

/**
 * API 路徑前綴 → 模組。依序比對，先中先贏。
 * 沒列到的路徑（例如 /auth/me）只要登入即可。
 */
const PATH_MODULES: [RegExp, string][] = [
  [/^\/dashboard/, 'dashboard'],
  [/^\/(sessions|bookings|templates)/, 'schedule'],
  [/^\/(members|memberships)/, 'members'],
  [/^\/(plans|class-types|coaches)/, 'catalog'],
  [/^\/reports/, 'reports'], // 含 /reports/sales 銷售紀錄（修改、作廢屬於「會員與售卡」）
  [/^\/(studio|line)/, 'settings'],
];

/**
 * 各模組共用的唯讀查詢（任何已登入員工都可讀）：教室名稱與時區、課程類型、教練、方案、會員搜尋。
 * 例如只開放「課表」的櫃檯，幫會員預約時仍需要搜尋會員、加開課時需要選課程類型與教練。
 */
const SHARED_READ = /^\/(studio|class-types|coaches|plans|members)\/?$/;

export function moduleForPath(path: string, method = 'GET'): string | null {
  if (method === 'GET' && SHARED_READ.test(path)) return null;
  for (const [re, key] of PATH_MODULES) if (re.test(path)) return key;
  return null;
}

export function sanitizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((k): k is string => typeof k === 'string' && MODULE_KEYS.includes(k)))];
}
