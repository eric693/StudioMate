// 商品零售：商品與庫存、櫃檯結帳（可開電子發票）、作廢回補庫存
import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { AuthRequest } from '../middleware/auth';
import { badRequest, notFound } from '../utils/http';
import { addDays, localDate, localToUtc } from '../utils/time';
import { getStudio } from '../services/studioService';
import { invoiceCreds, issueInvoice, voidInvoice } from '../services/ecpay';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式須為 YYYY-MM-DD');
const productSchema = z.object({
  name: z.string().trim().min(1, '請填寫商品名稱').max(60),
  category: z.string().trim().max(30).nullable().optional(),
  sku: z.string().trim().max(40).nullable().optional(),
  price: z.coerce.number().int().min(0).max(1_000_000),
  cost: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  trackStock: z.boolean().optional(),
  lowStock: z.coerce.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});

export async function listProducts(req: AuthRequest, res: Response) {
  const q = String(req.query.q ?? '').trim();
  res.json(await prisma.product.findMany({
    where: { userId: req.userId!, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q } }, { category: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  }));
}
export async function createProduct(req: AuthRequest, res: Response) {
  const d = productSchema.extend({ stock: z.coerce.number().int().min(0).max(1_000_000).optional() }).parse(req.body);
  const p = await prisma.product.create({ data: { ...d, userId: req.userId! } });
  if (d.stock) await prisma.stockMove.create({ data: { userId: req.userId!, productId: p.id, qty: d.stock, reason: 'RESTOCK', note: '期初庫存' } });
  res.status(201).json(p);
}
export async function updateProduct(req: AuthRequest, res: Response) {
  const own = await prisma.product.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到商品');
  res.json(await prisma.product.update({ where: { id: own.id }, data: productSchema.partial().parse(req.body) }));
}
export async function deleteProduct(req: AuthRequest, res: Response) {
  const own = await prisma.product.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到商品');
  if (await prisma.productSaleItem.count({ where: { productId: own.id } })) throw badRequest('這個商品有銷售紀錄，請改為停售');
  await prisma.product.delete({ where: { id: own.id } });
  res.json({ ok: true });
}

/** 進貨（正數）、盤點調整（直接設定實際數量） */
export async function adjustStock(req: AuthRequest, res: Response) {
  const d = z.object({ mode: z.enum(['restock', 'count']), qty: z.coerce.number().int().min(-1_000_000).max(1_000_000), note: z.string().max(200).optional() }).parse(req.body);
  const own = await prisma.product.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到商品');
  const delta = d.mode === 'restock' ? d.qty : d.qty - own.stock;
  if (d.mode === 'restock' && d.qty <= 0) throw badRequest('進貨數量須大於 0');
  if (d.mode === 'count' && d.qty < 0) throw badRequest('盤點數量不能是負數');
  if (!delta) { res.json(own); return; }
  const [p] = await prisma.$transaction([
    prisma.product.update({ where: { id: own.id }, data: { stock: { increment: delta } } }),
    prisma.stockMove.create({ data: { userId: req.userId!, productId: own.id, qty: delta, reason: d.mode === 'restock' ? 'RESTOCK' : 'ADJUST', note: d.note } }),
  ]);
  res.json(p);
}

export async function stockMoves(req: AuthRequest, res: Response) {
  const own = await prisma.product.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!own) throw notFound('找不到商品');
  res.json(await prisma.stockMove.findMany({ where: { productId: own.id }, orderBy: { createdAt: 'desc' }, take: 200 }));
}

/** 結帳：檢查庫存 → 扣庫存並建立銷售（同一交易） → 開發票（失敗不影響銷售，可稍後補開） */
export async function createSale(req: AuthRequest, res: Response) {
  const d = z.object({
    memberId: z.string().nullable().optional(),
    items: z.array(z.object({ productId: z.string(), qty: z.coerce.number().int().min(1).max(999) })).min(1, '請選擇商品').max(50),
    discount: z.coerce.number().int().min(0).optional(),
    payMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'LINEPAY', 'OTHER']).optional(),
    note: z.string().max(200).optional(),
    invoice: z.boolean().optional(),
  }).parse(req.body);
  const userId = req.userId!;
  if (d.memberId && !(await prisma.member.findFirst({ where: { id: d.memberId, userId } }))) throw notFound('找不到會員');
  const sale = await prisma.$transaction(async (tx) => {
    const ids = [...new Set(d.items.map((i) => i.productId))];
    const products = await tx.product.findMany({ where: { id: { in: ids }, userId } });
    const byId = Object.fromEntries(products.map((p) => [p.id, p]));
    const qty: Record<string, number> = {};
    for (const it of d.items) {
      if (!byId[it.productId]) throw notFound('找不到商品');
      if (!byId[it.productId].active) throw badRequest(`「${byId[it.productId].name}」已停售`);
      qty[it.productId] = (qty[it.productId] ?? 0) + it.qty;
    }
    for (const [id, n] of Object.entries(qty)) {
      const p = byId[id];
      if (!p.trackStock) continue;
      // 條件扣庫存：同時結帳時不會扣成負數
      const r = await tx.product.updateMany({ where: { id, stock: { gte: n } }, data: { stock: { decrement: n } } });
      if (!r.count) throw badRequest(`「${p.name}」庫存不足（剩 ${p.stock}）`);
    }
    const subtotal = Object.entries(qty).reduce((a, [id, n]) => a + byId[id].price * n, 0);
    const discount = Math.min(subtotal, d.discount ?? 0);
    const s = await tx.productSale.create({
      data: {
        userId, memberId: d.memberId ?? null, total: subtotal - discount, discount, payMethod: d.payMethod ?? 'CASH', note: d.note, createdById: req.authUserId,
        items: { create: Object.entries(qty).map(([id, n]) => ({ productId: id, name: byId[id].name, price: byId[id].price, qty: n })) },
      },
      include: { items: true },
    });
    await tx.stockMove.createMany({ data: Object.entries(qty).filter(([id]) => byId[id].trackStock).map(([id, n]) => ({ userId, productId: id, qty: -n, reason: 'SALE', saleId: s.id })) });
    return s;
  });
  const studio = await getStudio(userId);
  if ((d.invoice ?? studio.invoiceEnabled) && studio.invoiceEnabled && sale.total > 0) await issueSaleInvoice(userId, sale.id).catch(() => undefined);
  res.status(201).json(await prisma.productSale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true, member: { select: { id: true, name: true } } } }));
}

async function issueSaleInvoice(userId: string, saleId: string) {
  const sale = await prisma.productSale.findFirst({ where: { id: saleId, userId }, include: { items: true, member: true } });
  if (!sale) throw notFound('找不到銷售紀錄');
  if (sale.invoiceStatus === 'ISSUED') throw badRequest('已開立發票');
  if (sale.status !== 'PAID' || sale.total <= 0) throw badRequest('這筆銷售不需要開立發票');
  const studio = await getStudio(userId);
  const m = sale.member;
  try {
    const r = await issueInvoice(invoiceCreds(studio), {
      relateNumber: `SP${sale.id.slice(-12)}${Date.now().toString(36).slice(-4)}`.toUpperCase().slice(0, 30),
      amount: sale.total, itemName: '商品', items: sale.items.map((i) => ({ name: i.name, price: i.price, qty: i.qty })),
      buyer: m ? { name: m.name, email: m.email, phone: m.phone, carrierType: m.invoiceCarrierType, carrierNum: m.invoiceCarrierNum, taxId: m.invoiceTaxId, title: m.invoiceTitle } : { name: '消費者' },
    });
    return prisma.productSale.update({ where: { id: sale.id }, data: { invoiceNo: r.invoiceNo, invoiceDate: new Date(r.invoiceDate.replace('+', 'T') + '+08:00'), invoiceStatus: 'ISSUED', invoiceError: null } });
  } catch (e) {
    await prisma.productSale.update({ where: { id: sale.id }, data: { invoiceStatus: 'FAILED', invoiceError: (e as Error).message.slice(0, 200) } });
    throw badRequest(`發票開立失敗：${(e as Error).message}`);
  }
}

export async function saleInvoiceHandler(req: AuthRequest, res: Response) {
  res.json(await issueSaleInvoice(req.userId!, req.params.id));
}

/** 作廢銷售：作廢發票 → 回補庫存 → 標記作廢 */
export async function voidSale(req: AuthRequest, res: Response) {
  const sale = await prisma.productSale.findFirst({ where: { id: req.params.id, userId: req.userId! }, include: { items: { include: { product: true } } } });
  if (!sale) throw notFound('找不到銷售紀錄');
  if (sale.status === 'VOID') throw badRequest('已經作廢');
  const studio = await getStudio(req.userId!);
  if (sale.invoiceStatus === 'ISSUED' && sale.invoiceNo && sale.invoiceDate) {
    try { await voidInvoice(invoiceCreds(studio), sale.invoiceNo, sale.invoiceDate, '銷售作廢'); } catch (e) { throw badRequest(`發票作廢失敗：${(e as Error).message}`); }
  }
  const tracked = sale.items.filter((i) => i.product.trackStock);
  await prisma.$transaction([
    ...tracked.map((i) => prisma.product.update({ where: { id: i.productId }, data: { stock: { increment: i.qty } } })),
    prisma.stockMove.createMany({ data: tracked.map((i) => ({ userId: req.userId!, productId: i.productId, qty: i.qty, reason: 'VOID', saleId: sale.id })) }),
    prisma.productSale.update({ where: { id: sale.id }, data: { status: 'VOID', ...(sale.invoiceStatus === 'ISSUED' ? { invoiceStatus: 'VOID' } : {}) } }),
  ]);
  res.json({ ok: true });
}

export async function listSales(req: AuthRequest, res: Response) {
  const studio = await getStudio(req.userId!);
  const f = z.object({ from: day.optional(), to: day.optional(), memberId: z.string().optional() }).parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')));
  const to = f.to ?? localDate(new Date(), studio.timezone);
  const from = f.from ?? addDays(to, -30);
  const sales = await prisma.productSale.findMany({
    where: { userId: req.userId!, createdAt: { gte: localToUtc(from, '00:00', studio.timezone), lt: localToUtc(addDays(to, 1), '00:00', studio.timezone) }, ...(f.memberId ? { memberId: f.memberId } : {}) },
    include: { items: true, member: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' }, take: 500,
  });
  const paid = sales.filter((s) => s.status === 'PAID');
  res.json({ from, to, total: paid.reduce((a, s) => a + s.total, 0), count: paid.length, sales });
}
