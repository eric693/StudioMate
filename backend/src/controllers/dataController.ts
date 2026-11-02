// 資料匯出（CSV，Excel 可直接開啟）與會員匯入
import { Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { badRequest } from '../utils/http';
import { addDays, dateOnly, formatLocal, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { coachPayReport } from './opsController';

const PLAN_KIND: Record<string, string> = { PACK: '堂數卡', PERIOD: '期限卡', DROPIN: '單堂' };
const PASS_STATUS: Record<string, string> = { ACTIVE: '使用中', FROZEN: '凍結中', EXPIRED: '已到期', CANCELLED: '已作廢' };
const PAY: Record<string, string> = { CASH: '現金', TRANSFER: '轉帳', CARD: '刷卡', LINEPAY: 'LINE Pay', OTHER: '其他' };
const BOOKING: Record<string, string> = { BOOKED: '已預約', WAITLIST: '候補', CANCELLED: '已取消', LATE_CANCELLED: '晚取消', ATTENDED: '出席', NO_SHOW: '未到' };

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // 避免 Excel 把以 = + - @ 開頭的內容當成公式執行
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send('﻿' + body); // BOM：讓 Excel 正確辨識 UTF-8 中文
}
const d10 = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

export async function exportMembers(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const today = dateOnly(localDate(new Date(), studio.timezone));
  const members = await prisma.member.findMany({
    where: { userId: req.userId! },
    include: { memberships: { where: { status: { in: ['ACTIVE', 'FROZEN'] }, endDate: { gte: today } }, orderBy: { endDate: 'asc' } }, referredBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  sendCsv(res, `會員_${localDate(new Date(), studio.timezone)}.csv`,
    ['姓名', '電話', 'Email', '生日', '狀態', 'LINE 綁定', '緊急聯絡人', '備註', '介紹人', '有效方案', '剩餘堂數', '到期日', '加入日期'],
    members.map((m) => {
      const p = m.memberships[0];
      return [m.name, m.phone, m.email, d10(m.birthday), m.status === 'ACTIVE' ? '使用中' : '停用', m.lineUserId ? '是' : '否', m.emergencyContact, m.note,
        m.referredBy?.name, m.memberships.map((x) => x.planName).join('、'), p ? (p.kind === 'PERIOD' ? '不限' : p.creditsLeft) : '', d10(p?.endDate), localDate(m.createdAt, studio.timezone)];
    }));
}

export async function exportSales(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const f = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const list = await prisma.membership.findMany({
    where: {
      userId: req.userId!,
      ...(f.from || f.to ? { paidAt: {
        ...(f.from ? { gte: localToUtc(f.from, '00:00', studio.timezone) } : {}),
        ...(f.to ? { lt: localToUtc(addDays(f.to, 1), '00:00', studio.timezone) } : {}),
      } } : {}),
    },
    include: { member: { select: { name: true, phone: true } }, order: { select: { tradeNo: true } } },
    orderBy: { paidAt: 'asc' },
  });
  sendCsv(res, `銷售紀錄_${localDate(new Date(), studio.timezone)}.csv`,
    ['售出日期', '會員', '電話', '方案', '類型', '總堂數', '剩餘堂數', '開始日', '到期日', '狀態', '折抵', '實收金額', '付款方式', '發票號碼', '發票狀態', '線上訂單', '備註'],
    list.map((m) => [localDate(m.paidAt, studio.timezone), m.member.name, m.member.phone, m.planName, PLAN_KIND[m.kind], m.creditsTotal ?? '不限', m.creditsLeft ?? '不限',
      d10(m.startDate), d10(m.endDate), PASS_STATUS[m.status], m.discount, m.price, PAY[m.payMethod], m.invoiceNo, m.invoiceStatus === 'ISSUED' ? '已開立' : m.invoiceStatus === 'VOID' ? '已作廢' : m.invoiceStatus === 'FAILED' ? '開立失敗' : '',
      m.order?.tradeNo, m.note]));
}

export async function exportAttendance(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const today = localDate(new Date(), studio.timezone);
  const f = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
  const from = f.from || addDays(today, -30), to = f.to || today;
  const list = await prisma.booking.findMany({
    where: { userId: req.userId!, session: { startsAt: { gte: localToUtc(from, '00:00', studio.timezone), lt: localToUtc(addDays(to, 1), '00:00', studio.timezone) } } },
    include: { member: { select: { name: true, phone: true } }, session: { include: { classType: true, coach: true, branch: true } }, membership: { select: { planName: true } } },
    orderBy: { session: { startsAt: 'asc' } },
  });
  sendCsv(res, `上課紀錄_${from}_${to}.csv`,
    ['上課時間', '課程', '教練', '分店', '教室', '會員', '電話', '狀態', '扣堂', '使用方案', '預約方式', '簽到時間'],
    list.map((b) => [formatLocal(b.session.startsAt, studio.timezone), b.session.classType.name, b.session.coach?.name, b.session.branch?.name, b.session.room,
      b.member.name, b.member.phone, BOOKING[b.status], b.creditsCharged, b.membership?.planName, b.source === 'MEMBER' ? '會員自行預約' : '櫃檯', b.checkedInAt ? formatLocal(b.checkedInAt, studio.timezone) : '']));
}

export async function exportCoachPay(req: AuthRequest, res: Response) {
  const month = z.string().regex(/^\d{4}-\d{2}$/).parse(req.query.month);
  const studio = await getStudio(req.userId!);
  const r = await coachPayReport(req.userId!, month);
  sendCsv(res, `教練薪資_${month}.csv`,
    ['教練', '上課時間', '課程', '出席人數', '名額', '課程產值', '薪資'],
    r.rows.flatMap((c) => [
      ...c.detail.map((d) => [c.coachName, formatLocal(d.startsAt, studio.timezone), d.className, d.heads, d.capacity, d.value, d.pay]),
      [`${c.coachName} 合計`, '', `${c.classes} 堂`, c.heads, '', c.value, c.pay],
    ]));
}

/* ---------- 會員匯入 ---------- */

const importRow = z.object({
  name: z.string().trim().min(1, '缺少姓名').max(40),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{6,20}$/, '電話格式不正確'),
  email: z.string().trim().email('Email 格式不正確').optional().or(z.literal('')),
  birthday: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '生日格式須為 YYYY-MM-DD').optional().or(z.literal('')),
  note: z.string().max(1000).optional(),
  planName: z.string().trim().optional(),
  creditsLeft: z.union([z.string(), z.number()]).optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, '到期日格式須為 YYYY-MM-DD').optional().or(z.literal('')),
});

/**
 * 從舊系統或 Excel 匯入會員。電話已存在的會員會更新姓名等資料（不重複建立）。
 * 有填方案名稱時，依現有方案建立一筆「匯入」的方案（剩餘堂數、到期日以檔案為準，金額記 0 不計入營收）。
 * dryRun＝true 時只檢查不寫入，回傳每列的結果供預覽。
 */
export async function importMembers(req: AuthRequest, res: Response) {
  const { rows, dryRun } = z.object({ rows: z.array(z.record(z.unknown())).min(1).max(2000), dryRun: z.boolean().optional() }).parse(req.body);
  const userId = req.userId!;
  const studio = await getStudio(userId);
  const today = localDate(new Date(), studio.timezone);
  const plans = Object.fromEntries((await prisma.plan.findMany({ where: { userId } })).map((p) => [p.name, p]));
  const existing = new Map((await prisma.member.findMany({ where: { userId }, select: { id: true, phone: true } })).map((m) => [m.phone.replace(/\D/g, ''), m.id]));
  const seen = new Set<string>();
  const results: { row: number; name?: string; action?: 'create' | 'update'; error?: string; pass?: string }[] = [];
  let created = 0, updated = 0, passes = 0;

  for (const [i, raw] of rows.entries()) {
    const row = i + 2; // 對應試算表列號（第 1 列為標題）
    const p = importRow.safeParse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])));
    if (!p.success) { results.push({ row, name: String(raw.name ?? ''), error: p.error.issues[0].message }); continue; }
    const d = p.data;
    const key = d.phone.replace(/\D/g, '');
    if (seen.has(key)) { results.push({ row, name: d.name, error: '檔案中電話重複' }); continue; }
    seen.add(key);
    const plan = d.planName ? plans[d.planName] : null;
    if (d.planName && !plan) { results.push({ row, name: d.name, error: `找不到方案「${d.planName}」，請先在「方案與課程」建立` }); continue; }
    const credits = d.creditsLeft === undefined || d.creditsLeft === '' ? null : Number(d.creditsLeft);
    if (plan && plan.kind !== 'PERIOD' && (credits === null || !Number.isInteger(credits) || credits < 0)) { results.push({ row, name: d.name, error: '堂數卡須填寫剩餘堂數' }); continue; }
    if (plan && !d.endDate) { results.push({ row, name: d.name, error: '有方案時須填寫到期日' }); continue; }
    const id = existing.get(key);
    results.push({ row, name: d.name, action: id ? 'update' : 'create', pass: plan ? `${plan.name}${plan.kind === 'PERIOD' ? '' : ` 剩 ${credits} 堂`}，${d.endDate} 到期` : undefined });
    if (dryRun) continue;

    const data = { name: d.name, phone: d.phone, email: d.email || null, birthday: d.birthday ? dateOnly(d.birthday) : null, note: d.note || null };
    let memberId = id;
    try {
      if (id) { await prisma.member.update({ where: { id }, data }); updated++; }
      else { memberId = (await prisma.member.create({ data: { ...data, userId } })).id; existing.set(key, memberId); created++; }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { results[results.length - 1] = { row, name: d.name, error: '電話與其他會員重複' }; continue; }
      throw e;
    }
    if (plan) {
      const total = plan.kind === 'PERIOD' ? null : Math.max(credits!, plan.credits ?? credits!);
      await prisma.membership.create({
        data: {
          userId, memberId: memberId!, planId: plan.id, planName: plan.name, kind: plan.kind, creditsTotal: total, creditsLeft: plan.kind === 'PERIOD' ? null : credits,
          classTypeIds: plan.classTypeIds, dailyLimit: plan.dailyLimit, startDate: dateOnly(today), endDate: dateOnly(d.endDate!),
          status: d.endDate! < today ? 'EXPIRED' : 'ACTIVE', price: 0, payMethod: 'OTHER', note: '資料匯入',
        },
      });
      passes++;
    }
  }
  const errors = results.filter((r) => r.error).length;
  if (dryRun) { res.json({ dryRun: true, total: rows.length, ok: rows.length - errors, errors, results }); return; }
  if (!created && !updated && errors) throw badRequest('沒有任何一列可以匯入，請檢查檔案內容');
  res.json({ created, updated, passes, errors, results: results.filter((r) => r.error) });
}
