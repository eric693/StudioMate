import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, Pencil, PackagePlus, ClipboardCheck, Receipt, Ban } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import Modal, { Field } from '../components/Modal';
import SearchBox from '../components/SearchBox';
import MemberPicker, { PickedMember, Tabs } from '../components/MemberPicker';
import { INVOICE_STATUS, PAY_METHOD, addDays, dateTime, localDay, money } from '../lib/format';

interface Product { id: string; name: string; category: string | null; sku: string | null; price: number; cost: number | null; stock: number; trackStock: boolean; lowStock: number; active: boolean }
interface Sale {
  id: string; total: number; discount: number; payMethod: string; status: 'PAID' | 'VOID'; note: string | null; createdAt: string;
  invoiceNo: string | null; invoiceStatus: string | null; invoiceError: string | null;
  member: { id: string; name: string } | null; items: { id: string; name: string; price: number; qty: number }[];
}

export default function Pos() {
  const [tab, setTab] = useState<'checkout' | 'products' | 'sales'>('checkout');
  const [products, setProducts] = useState<Product[]>([]);
  const load = () => api.get('/products').then((r) => setProducts(r.data));
  useEffect(() => { load(); }, []);
  const low = products.filter((p) => p.active && p.trackStock && p.stock <= p.lowStock).length;
  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-800">商品零售</h1>
          <p className="text-sm text-gray-400">{products.filter((p) => p.active).length} 項商品{low ? `・${low} 項庫存偏低` : ''}</p>
        </div>
      </div>
      <HowTo module="pos" />
      <Tabs tabs={[['checkout', '收銀'], ['products', '商品與庫存'], ['sales', '銷售紀錄']]} value={tab} onChange={setTab} />
      {tab === 'checkout' && <Checkout products={products.filter((p) => p.active)} onDone={load} />}
      {tab === 'products' && <Products products={products} onChanged={load} />}
      {tab === 'sales' && <Sales onChanged={load} />}
    </div>
  );
}

function Checkout({ products, onDone }: { products: Product[]; onDone: () => void }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [member, setMember] = useState<PickedMember | null>(null);
  const [f, setF] = useState({ discount: '', payMethod: 'CASH', note: '' });
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const cats = useMemo(() => [...new Set(products.map((p) => p.category || '其他'))], [products]);
  const [cat, setCat] = useState('');
  const shown = products.filter((p) => (!cat || (p.category || '其他') === cat) && (!q || p.name.includes(q) || p.sku?.includes(q)));
  const lines = Object.entries(cart).map(([id, n]) => ({ p: products.find((x) => x.id === id)!, n })).filter((l) => l.p);
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.n, 0);
  const total = Math.max(0, subtotal - (+f.discount || 0));
  const add = (p: Product, d = 1) => setCart((c) => {
    const n = (c[p.id] ?? 0) + d;
    if (p.trackStock && n > p.stock) return c;
    const next = { ...c };
    if (n <= 0) delete next[p.id]; else next[p.id] = n;
    return next;
  });
  async function pay() {
    const r = await api.post('/sales', { memberId: member?.id ?? null, items: lines.map((l) => ({ productId: l.p.id, qty: l.n })), discount: +f.discount || 0, payMethod: f.payMethod, note: f.note || undefined });
    setMsg(`已結帳 ${money(r.data.total)}${r.data.invoiceNo ? `，發票 ${r.data.invoiceNo}` : r.data.invoiceStatus === 'FAILED' ? `，發票開立失敗：${r.data.invoiceError}` : ''}`);
    setCart({}); setMember(null); setF({ discount: '', payMethod: 'CASH', note: '' }); onDone();
  }
  if (!products.length) return <div className="card text-sm text-gray-500">還沒有商品，請先到「商品與庫存」新增。</div>;
  return (
    <div className="grid md:grid-cols-[1fr_20rem] gap-4 items-start">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap gap-2 items-center">
          <SearchBox value={q} onChange={setQ} placeholder="搜尋商品或條碼" />
          <div className="flex gap-1 flex-wrap">
            {['', ...cats].map((c) => <button key={c} onClick={() => setCat(c)} className={`text-xs px-2.5 py-1 rounded-full ${cat === c ? 'bg-brand text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{c || '全部'}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {shown.map((p) => {
            const out = p.trackStock && p.stock - (cart[p.id] ?? 0) <= 0;
            return (
              <button key={p.id} disabled={out} onClick={() => add(p)} className={`card text-left p-3 transition ${out ? 'opacity-40' : 'hover:ring-2 hover:ring-brand/30'}`}>
                <div className="text-sm font-medium text-gray-800 line-clamp-2">{p.name}</div>
                <div className="text-brand font-semibold mt-1">{money(p.price)}</div>
                {p.trackStock && <div className={`text-[11px] mt-0.5 ${p.stock <= p.lowStock ? 'text-orange-500' : 'text-gray-400'}`}>庫存 {p.stock}</div>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="card space-y-3 md:sticky md:top-0">
        <h2 className="font-semibold text-gray-700">結帳</h2>
        {msg && <div className="text-sm bg-green-50 text-green-700 rounded-xl px-3 py-2">{msg}</div>}
        {lines.length === 0 ? <p className="text-sm text-gray-400">點選左側商品加入。</p> : (
          <div className="divide-y divide-gray-50">
            {lines.map(({ p, n }) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="flex-1 min-w-0 truncate text-gray-700">{p.name}</span>
                <button className="p-1 rounded hover:bg-gray-100" onClick={() => add(p, -1)} aria-label="減少"><Minus className="w-3.5 h-3.5" /></button>
                <span className="w-5 text-center tabular-nums">{n}</span>
                <button className="p-1 rounded hover:bg-gray-100" onClick={() => add(p)} aria-label="增加"><Plus className="w-3.5 h-3.5" /></button>
                <span className="w-16 text-right tabular-nums">{money(p.price * n).replace('NT$ ', '')}</span>
              </div>
            ))}
          </div>
        )}
        <Field label="會員（選填，發票會用會員的載具）"><MemberPicker value={member} onChange={setMember} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="折扣"><input type="number" min={0} className="input" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></Field>
          <Field label="付款方式"><select className="input" value={f.payMethod} onChange={(e) => setF({ ...f, payMethod: e.target.value })}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <div className="flex justify-between items-baseline"><span className="text-sm text-gray-500">應收</span><span className="text-2xl font-bold text-gray-800 tabular-nums">{money(total)}</span></div>
        <button className="btn-primary w-full py-3" disabled={!lines.length} onClick={pay}>收款完成</button>
      </div>
    </div>
  );
}

function Products({ products, onChanged }: { products: Product[]; onChanged: () => void }) {
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [stock, setStock] = useState<{ p: Product; mode: 'restock' | 'count' } | null>(null);
  const [q, setQ] = useState('');
  const list = products.filter((p) => !q || p.name.includes(q) || p.category?.includes(q) || p.sku?.includes(q));
  async function remove(p: Product) {
    if (!confirm(`刪除「${p.name}」？`)) return;
    await api.delete(`/products/${p.id}`); onChanged();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={q} onChange={setQ} placeholder="搜尋商品、分類、條碼" />
        <button className="btn-primary ml-auto" onClick={() => setEdit('new')}>新增商品</button>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
          <thead><tr className="text-xs text-gray-400 text-left border-b border-gray-100"><th className="px-4 py-2 font-normal">商品</th><th className="font-normal">售價</th><th className="font-normal">成本</th><th className="font-normal">庫存</th><th /></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
                <td className="px-4 py-2"><div className="text-gray-800">{p.name}{!p.active && <span className="text-xs text-gray-400 ml-1">停售</span>}</div><div className="text-xs text-gray-400">{[p.category, p.sku].filter(Boolean).join('・')}</div></td>
                <td className="tabular-nums">{money(p.price)}</td>
                <td className="tabular-nums text-gray-500">{p.cost != null ? money(p.cost) : '—'}</td>
                <td className={`tabular-nums ${p.trackStock && p.stock <= p.lowStock ? 'text-orange-600 font-medium' : ''}`}>{p.trackStock ? p.stock : '不追蹤'}</td>
                <td className="pr-3">
                  <div className="flex gap-1 justify-end">
                    {p.trackStock && <button className="p-1.5 rounded-lg hover:bg-gray-50" title="進貨" aria-label="進貨" onClick={() => setStock({ p, mode: 'restock' })}><PackagePlus className="w-4 h-4 text-gray-500" /></button>}
                    {p.trackStock && <button className="p-1.5 rounded-lg hover:bg-gray-50" title="盤點" aria-label="盤點" onClick={() => setStock({ p, mode: 'count' })}><ClipboardCheck className="w-4 h-4 text-gray-500" /></button>}
                    <button className="p-1.5 rounded-lg hover:bg-gray-50" title="編輯" aria-label="編輯" onClick={() => setEdit(p)}><Pencil className="w-4 h-4 text-gray-500" /></button>
                    <button className="p-1.5 rounded-lg hover:bg-gray-50" title="刪除" aria-label="刪除" onClick={() => remove(p)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="text-sm text-gray-400 p-4">沒有商品。</p>}
      </div>
      {edit && <ProductForm p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
      {stock && <StockForm {...stock} onClose={() => setStock(null)} onSaved={() => { setStock(null); onChanged(); }} />}
    </div>
  );
}

function ProductForm({ p, onClose, onSaved }: { p: Product | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', category: p?.category ?? '', sku: p?.sku ?? '', price: String(p?.price ?? ''), cost: p?.cost != null ? String(p.cost) : '', stock: '', trackStock: p?.trackStock ?? true, lowStock: String(p?.lowStock ?? 3), active: p?.active ?? true });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: f.name, category: f.category || null, sku: f.sku || null, price: +f.price, cost: f.cost === '' ? null : +f.cost, trackStock: f.trackStock, lowStock: +f.lowStock || 0, active: f.active, ...(p ? {} : { stock: +f.stock || 0 }) };
    if (p) await api.put(`/products/${p.id}`, body); else await api.post('/products', body);
    onSaved();
  }
  return (
    <Modal title={p ? '編輯商品' : '新增商品'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="名稱"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="分類"><input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="飲料、器材、服飾" /></Field>
          <Field label="條碼／貨號"><input className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          <Field label="售價"><input type="number" min={0} className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></Field>
          <Field label="成本（選填）"><input type="number" min={0} className="input" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
          {!p && f.trackStock && <Field label="期初庫存"><input type="number" min={0} className="input" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></Field>}
          {f.trackStock && <Field label="庫存提醒門檻"><input type="number" min={0} className="input" value={f.lowStock} onChange={(e) => setF({ ...f, lowStock: e.target.value })} /></Field>}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.trackStock} onChange={(e) => setF({ ...f, trackStock: e.target.checked })} />追蹤庫存（服務類商品如毛巾租借可關閉）</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />販售中</label>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

function StockForm({ p, mode, onClose, onSaved }: { p: Product; mode: 'restock' | 'count'; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState(mode === 'count' ? String(p.stock) : '');
  const [note, setNote] = useState('');
  const [moves, setMoves] = useState<{ id: string; qty: number; reason: string; note: string | null; createdAt: string }[]>([]);
  useEffect(() => { api.get(`/products/${p.id}/moves`).then((r) => setMoves(r.data.slice(0, 10))); }, [p.id]);
  const REASON: Record<string, string> = { RESTOCK: '進貨', ADJUST: '盤點調整', SALE: '銷售', VOID: '作廢回補' };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/products/${p.id}/stock`, { mode, qty: +qty, note: note || undefined });
    onSaved();
  }
  return (
    <Modal title={`${mode === 'restock' ? '進貨' : '盤點'}「${p.name}」`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-500">目前庫存 {p.stock}</p>
        <Field label={mode === 'restock' ? '進貨數量' : '實際盤點數量'}><input type="number" min={mode === 'restock' ? 1 : 0} className="input" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
        <Field label="備註"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'restock' ? '供應商、進貨單號' : '例如：破損 2 瓶'} /></Field>
        <button className="btn-primary w-full">儲存</button>
      </form>
      {moves.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-gray-400 mb-1">最近異動</div>
          {moves.map((m) => <div key={m.id} className="flex justify-between text-xs text-gray-600 py-0.5"><span>{dateTime(m.createdAt)} {REASON[m.reason] ?? m.reason}{m.note ? `（${m.note}）` : ''}</span><span className={m.qty > 0 ? 'text-green-600' : 'text-red-500'}>{m.qty > 0 ? '+' : ''}{m.qty}</span></div>)}
        </div>
      )}
    </Modal>
  );
}

function Sales({ onChanged }: { onChanged: () => void }) {
  const [range, setRange] = useState({ from: addDays(localDay(), -30), to: localDay() });
  const [data, setData] = useState<{ total: number; count: number; sales: Sale[] } | null>(null);
  const load = () => api.get('/sales', { params: range }).then((r) => setData(r.data));
  useEffect(() => { load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  async function voidSale(s: Sale) {
    if (!confirm(`作廢這筆 ${money(s.total)} 的銷售？庫存會加回去${s.invoiceStatus === 'ISSUED' ? '，發票會一併作廢' : ''}。`)) return;
    await api.post(`/sales/${s.id}/void`); load(); onChanged();
  }
  async function invoice(s: Sale) { await api.post(`/sales/${s.id}/invoice`); load(); }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <input type="date" className="input w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="開始日期" />
        <span className="text-gray-400">~</span>
        <input type="date" className="input w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="結束日期" />
        {data && <span className="text-gray-500 ml-auto">{data.count} 筆・合計 <b className="text-gray-800">{money(data.total)}</b></span>}
      </div>
      <div className="card p-0 overflow-hidden">
        {data?.sales.length === 0 && <p className="text-sm text-gray-400 p-4">這段期間沒有銷售。</p>}
        <div className="divide-y divide-gray-50">
          {data?.sales.map((s) => (
            <div key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${s.status === 'VOID' ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-[14rem]">
                <div className="text-sm text-gray-800">{s.items.map((i) => `${i.name}×${i.qty}`).join('、')}{s.status === 'VOID' && <span className="text-xs text-red-500 ml-2">已作廢</span>}</div>
                <div className="text-xs text-gray-400">
                  {dateTime(s.createdAt)}・{PAY_METHOD[s.payMethod]}{s.discount ? `・折扣 ${s.discount}` : ''}
                  {s.member && <>・<Link className="text-brand" to={`/members/${s.member.id}`}>{s.member.name}</Link></>}
                  {s.invoiceStatus && `・發票${INVOICE_STATUS[s.invoiceStatus]}${s.invoiceNo ? ` ${s.invoiceNo}` : ''}`}
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums">{money(s.total)}</span>
              {s.status === 'PAID' && (
                <div className="flex gap-1">
                  {s.invoiceStatus !== 'ISSUED' && s.total > 0 && <button className="p-1.5 rounded-lg hover:bg-gray-50" title="開立發票" aria-label="開立發票" onClick={() => invoice(s)}><Receipt className="w-4 h-4 text-gray-500" /></button>}
                  <button className="p-1.5 rounded-lg hover:bg-gray-50" title="作廢" aria-label="作廢" onClick={() => voidSale(s)}><Ban className="w-4 h-4 text-gray-400" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
