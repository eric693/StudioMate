import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Ban, Trash2, Download, Receipt, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import Modal, { Field } from '../components/Modal';
import SearchBox from '../components/SearchBox';
import { Member, Membership } from '../types';
import { INVOICE_STATUS, PASS_STATUS, PAY_METHOD, PLAN_KIND, addDays, dateStr, dateTime, downloadCsv, localDay, money } from '../lib/format';
import { SellForm } from './MemberDetail';
import { Deferred, Insights, Refunds } from './ReportsExtra';

type Sale = Membership & { member: { id: string; name: string; phone: string }; bookingCount: number };

interface Report { months: { month: string; revenue: number; count: number; products: number; lockers: number; rentals: number; refunds: number; net: number }[]; plans: { planName: string; revenue: number; count: number }[]; methods: Record<string, number> }

export default function Reports() {
  const [tab, setTab] = useState<'chart' | 'sales' | 'coach' | 'insights' | 'deferred' | 'refunds'>('chart');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {([['chart', '營收統計'], ['sales', '銷售紀錄'], ['coach', '教練薪資'], ['insights', '營運分析'], ['deferred', '預收款'], ['refunds', '退費紀錄']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-lg text-sm whitespace-nowrap ${tab === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'chart' && <Revenue />}
      {tab === 'sales' && <Sales />}
      {tab === 'coach' && <CoachPay />}
      {tab === 'insights' && <Insights />}
      {tab === 'deferred' && <Deferred />}
      {tab === 'refunds' && <Refunds />}
    </div>
  );
}

function Revenue() {
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => { api.get('/reports/revenue').then((x) => setR(x.data)); }, []);
  if (!r) return <div className="text-gray-400 text-sm">載入中…</div>;
  const total = r.months.reduce((s, m) => s + m.net, 0);
  const max = Math.max(1, ...r.months.map((m) => m.revenue + m.products + m.lockers + m.rentals));
  const methodTotal = Math.max(1, Object.values(r.methods).reduce((a, b) => a + b, 0));

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-800">營收報表</h1><p className="text-sm text-gray-400">近 12 個月淨營收 {money(total)}（方案＋商品＋置物櫃＋場地租借－退費）</p></div>
      </div>
      <HowTo module="reports" />
      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-4">每月營收</h2>
        <div className="flex items-end gap-1.5 h-48" role="img" aria-label="近 12 個月每月營收長條圖">
          {r.months.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full min-w-0 group">
              <div className="text-[10px] text-gray-500 mb-1 opacity-0 group-hover:opacity-100 whitespace-nowrap">{m.revenue ? `${Math.round(m.revenue / 1000)}k` : ''}</div>
              <div className="w-full flex flex-col justify-end" style={{ height: `${((m.revenue + m.products + m.lockers + m.rentals) / max) * 100}%` }} title={`${m.month}：方案 ${money(m.revenue)}、其他 ${money(m.products + m.lockers + m.rentals)}、退費 ${money(m.refunds)}`}>
                {m.products + m.lockers + m.rentals > 0 && <div className="w-full rounded-t-md bg-amber-400/80" style={{ flex: m.products + m.lockers + m.rentals }} />}
                {m.revenue > 0 && <div className={`w-full bg-brand/80 group-hover:bg-brand ${m.products + m.lockers + m.rentals ? '' : 'rounded-t-md'}`} style={{ flex: m.revenue, minHeight: 2 }} />}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{+m.month.slice(5)}月</div>
            </div>
          ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-400 text-left"><th className="py-1 font-normal">月份</th><th className="font-normal text-right">方案（筆）</th><th className="font-normal text-right">商品</th><th className="font-normal text-right">置物櫃</th><th className="font-normal text-right">場地</th><th className="font-normal text-right">退費</th><th className="font-normal text-right">淨營收</th></tr></thead>
            <tbody className="divide-y divide-gray-50 tabular-nums">
              {[...r.months].reverse().filter((m) => m.count || m.products || m.lockers || m.rentals || m.refunds).map((m) => (
                <tr key={m.month}>
                  <td className="py-1.5 text-gray-600">{m.month}</td>
                  <td className="text-right text-gray-700 whitespace-nowrap">{money(m.revenue)}<span className="text-xs text-gray-400">（{m.count}）</span></td>
                  <td className="text-right text-gray-600">{m.products ? money(m.products) : '—'}</td>
                  <td className="text-right text-gray-600">{m.lockers ? money(m.lockers) : '—'}</td>
                  <td className="text-right text-gray-600">{m.rentals ? money(m.rentals) : '—'}</td>
                  <td className="text-right text-red-500">{m.refunds ? `-${money(m.refunds)}` : '—'}</td>
                  <td className="text-right text-gray-800 font-medium">{money(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-3">各方案</h2>
          {r.plans.length === 0 ? <p className="text-sm text-gray-400">還沒有銷售紀錄。</p> : (
            <div className="divide-y divide-gray-50">
              {r.plans.map((p) => (
                <div key={p.planName} className="flex justify-between py-2 text-sm"><span className="text-gray-600">{p.planName}<span className="text-xs text-gray-400 ml-2">{p.count} 筆</span></span><span className="text-gray-800">{money(p.revenue)}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-3">付款方式</h2>
          {Object.keys(r.methods).length === 0 ? <p className="text-sm text-gray-400">還沒有銷售紀錄。</p> : (
            <div className="space-y-2.5">
              {Object.entries(r.methods).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-sm"><span className="text-gray-600">{PAY_METHOD[k] ?? k}</span><span className="text-gray-800">{money(v)}<span className="text-xs text-gray-400 ml-1">{Math.round((v / methodTotal) * 100)}%</span></span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full bg-brand rounded-full" style={{ width: `${(v / methodTotal) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sales() {
  const [list, setList] = useState<Sale[] | null>(null);
  const [f, setF] = useState({ q: '', status: '', kind: '', payMethod: '', from: '', to: '' });
  const [modal, setModal] = useState<'sell' | Sale | null>(null);
  const load = () => api.get('/reports/sales', { params: f }).then((r) => setList(r.data));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const total = (list ?? []).filter((x) => x.status !== 'CANCELLED').reduce((a, x) => a + x.price, 0);

  async function voidSale(x: Sale) {
    if (!confirm(`作廢 ${x.member.name} 的「${x.planName}」？作廢後無法再使用，營收也不再計入。${x.invoiceStatus === 'ISSUED' ? '\n已開立的發票會一併作廢。' : ''}`)) return;
    await api.put(`/memberships/${x.id}`, { status: 'CANCELLED' }); load();
  }
  async function issue(x: Sale) {
    if (!confirm(`開立 ${money(x.price)} 的電子發票給 ${x.member.name}？`)) return;
    await api.post(`/memberships/${x.id}/invoice`); load();
  }
  async function voidInvoice(x: Sale) {
    const reason = prompt('作廢原因（20 字內）：', '開立錯誤');
    if (reason === null) return;
    await api.post(`/memberships/${x.id}/invoice/void`, { reason }); load();
  }
  async function remove(x: Sale) {
    if (!confirm(`刪除 ${x.member.name} 的「${x.planName}」售卡紀錄？（僅限輸入錯誤、尚未使用的紀錄）`)) return;
    await api.delete(`/memberships/${x.id}`); load();
  }
  return (
    <div className="space-y-4">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-800">銷售紀錄</h1><p className="text-sm text-gray-400">{list ? `${list.length} 筆・實收 ${money(total)}（不含作廢）` : '載入中…'}</p></div>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-1" onClick={() => downloadCsv(api, '/reports/export/sales', { from: f.from, to: f.to }, 'sales.csv')}><Download className="w-4 h-4" />匯出 CSV</button>
          <button className="btn-primary flex items-center gap-1" onClick={() => setModal('sell')}><Plus className="w-4 h-4" />新增售卡</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={f.q} onChange={(v) => set('q', v)} placeholder="搜尋會員姓名、電話、方案" />
        <select className="input w-auto text-sm" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="狀態"><option value="">全部狀態</option>{Object.entries(PASS_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-auto text-sm" value={f.kind} onChange={(e) => set('kind', e.target.value)} aria-label="方案類型"><option value="">全部類型</option>{Object.entries(PLAN_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-auto text-sm" value={f.payMethod} onChange={(e) => set('payMethod', e.target.value)} aria-label="付款方式"><option value="">全部付款方式</option>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <span className="flex items-center gap-1 text-sm text-gray-400">
          <input type="date" className="input w-auto text-sm" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="售出日期起" />～
          <input type="date" className="input w-auto text-sm" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="售出日期迄" />
        </span>
        {Object.values(f).some(Boolean) && <button className="text-xs text-brand hover:underline" onClick={() => setF({ q: '', status: '', kind: '', payMethod: '', from: '', to: '' })}>清除篩選</button>}
      </div>
      <div className="card p-0 overflow-hidden">
        {list && list.length === 0 ? <p className="text-sm text-gray-400 p-4">沒有符合條件的銷售紀錄。</p> : (
          <div className="divide-y divide-gray-50">
            {(list ?? []).map((x) => (
              <div key={x.id} className={`flex items-center gap-3 px-4 py-3 ${x.status === 'CANCELLED' ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">
                    <Link to={`/members/${x.member.id}`} className="font-medium hover:text-brand">{x.member.name}</Link>
                    <span className="text-gray-500 ml-2">{x.planName}</span>
                    <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 rounded ml-2">{PASS_STATUS[x.status]}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate">{dateStr(x.paidAt)}・{PAY_METHOD[x.payMethod]}・{dateStr(x.startDate)} ~ {dateStr(x.endDate)}{x.discount ? `・折抵 ${x.discount}` : ''}{x.note ? `・${x.note}` : ''}</div>
                  {x.invoiceStatus && (
                    <div className={`text-xs ${x.invoiceStatus === 'FAILED' ? 'text-red-500' : x.invoiceStatus === 'VOID' ? 'text-gray-400' : 'text-green-600'}`}>
                      發票{INVOICE_STATUS[x.invoiceStatus]}{x.invoiceNo ? ` ${x.invoiceNo}` : ''}{x.invoiceStatus === 'FAILED' && x.invoiceError ? `：${x.invoiceError}` : ''}
                    </div>
                  )}
                </div>
                <span className={`text-sm font-semibold ${x.status === 'CANCELLED' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{money(x.price)}</span>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" title="編輯" onClick={() => setModal(x)}><Pencil className="w-4 h-4 text-gray-400" /></button>
                {x.status !== 'CANCELLED' && x.price > 0 && x.invoiceStatus !== 'ISSUED' && <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="開立發票" title="開立發票" onClick={() => issue(x)}><Receipt className="w-4 h-4 text-gray-400" /></button>}
                {x.invoiceStatus === 'ISSUED' && x.status !== 'CANCELLED' && <button className="p-1.5 rounded-lg hover:bg-gray-50 text-[11px] text-gray-400" title="作廢發票" onClick={() => voidInvoice(x)}>作廢發票</button>}
                {x.status !== 'CANCELLED' && <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="作廢" title="作廢" onClick={() => voidSale(x)}><Ban className="w-4 h-4 text-gray-400" /></button>}
                {x.bookingCount === 0 && <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" title="刪除" onClick={() => remove(x)}><Trash2 className="w-4 h-4 text-gray-400" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
      {modal === 'sell' && <NewSale onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {modal && modal !== 'sell' && <EditSale x={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}

/** 從銷售紀錄新增：先選會員，再沿用會員頁的售卡表單 */
function NewSale({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [member, setMember] = useState<Member | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api.get('/members', { params: { q, status: 'ACTIVE' } }).then((r) => setResults(r.data.slice(0, 8))), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (member) return <SellForm memberId={member.id} onClose={onClose} onSaved={onSaved} />;
  return (
    <Modal title="新增售卡：選擇會員" onClose={onClose}>
      <input className="input" autoFocus placeholder="輸入會員姓名或電話" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="divide-y divide-gray-50 mt-2">
        {results.map((m) => (
          <button key={m.id} className="w-full text-left py-2 px-1 hover:bg-gray-50 text-sm flex justify-between" onClick={() => setMember(m)}>
            <span className="font-medium text-gray-800">{m.name}</span><span className="text-gray-400">{m.phone}</span>
          </button>
        ))}
        {q.trim() && results.length === 0 && <p className="text-sm text-gray-400 py-2">找不到會員，請先到「會員」新增。</p>}
      </div>
    </Modal>
  );
}

function EditSale({ x, onClose, onSaved }: { x: Sale; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ price: String(x.price), payMethod: x.payMethod, note: x.note ?? '', status: x.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.put(`/memberships/${x.id}`, { price: +f.price, payMethod: f.payMethod, note: f.note || null, ...(f.status !== (x.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE') ? { status: f.status } : {}) });
    onSaved();
  }
  return (
    <Modal title={`編輯售卡：${x.member.name}・${x.planName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="實收金額"><input type="number" min={0} className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></Field>
          <Field label="付款方式"><select className="input" value={f.payMethod} onChange={(e) => setF({ ...f, payMethod: e.target.value })}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label="備註"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Field label="狀態" hint="剩餘堂數、到期日、凍結請到會員頁調整"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ACTIVE">有效</option><option value="CANCELLED">作廢</option></select></Field>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

interface CoachRow {
  coachId: string; coachName: string; classes: number; heads: number; fillRate: number | null; value: number; pay: number;
  rule: { payPerClass: number; payPerHead: number; headThreshold: number; revenueShare: number; tiers?: { min: number; rate: number }[]; appliedRate?: number };
  detail: { sessionId: string; startsAt: string; className: string; heads: number; capacity: number; value: number; pay: number }[];
}

function CoachPay() {
  const [month, setMonth] = useState(localDay().slice(0, 7));
  const [r, setR] = useState<{ rows: CoachRow[]; totals: { classes: number; value: number; pay: number } } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [att, setAtt] = useState({ from: addDays(localDay(), -30), to: localDay() });
  useEffect(() => { setR(null); api.get('/reports/coach-pay', { params: { month } }).then((x) => setR(x.data)); }, [month]);
  const rows = (r?.rows ?? []).filter((x) => !q || x.coachName.includes(q));
  return (
    <div className="space-y-4">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-800">教練薪資</h1><p className="text-sm text-gray-400">{r ? `${r.totals.classes} 堂・課程產值 ${money(r.totals.value)}・薪資合計 ${money(r.totals.pay)}` : '載入中…'}</p></div>
        <div className="flex gap-2 items-center">
          <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="月份" />
          <button className="btn-secondary flex items-center gap-1" onClick={() => downloadCsv(api, '/reports/export/coach-pay', { month }, `coach-pay-${month}.csv`)}><Download className="w-4 h-4" />匯出</button>
        </div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="搜尋教練" />
      <div className="card p-0 overflow-hidden">
        {r && rows.length === 0 ? <p className="text-sm text-gray-400 p-4">這個月沒有已結束的課程。</p> : (
          <div className="divide-y divide-gray-50">
            {rows.map((c) => (
              <div key={c.coachId}>
                <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50" onClick={() => setOpen(open === c.coachId ? null : c.coachId)}>
                  {open === c.coachId ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{c.coachName}</div>
                    <div className="text-xs text-gray-400">{c.classes} 堂・{c.heads} 人次{c.fillRate !== null ? `・平均滿班 ${c.fillRate}%` : ''}・產值 {money(c.value)}</div>
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{money(c.pay)}</span>
                </button>
                {open === c.coachId && (
                  <div className="px-4 pb-3 pl-11">
                    <p className="text-xs text-gray-400 mb-2">規則：每堂 {c.rule.payPerClass}{c.rule.payPerHead ? `、超過 ${c.rule.headThreshold} 人每人 +${c.rule.payPerHead}` : ''}{c.rule.tiers?.length ? `、階梯抽成（${c.rule.tiers.map((t) => `${t.min.toLocaleString()} 起 ${t.rate}%`).join('／')}），本月套用 ${c.rule.appliedRate}%` : c.rule.revenueShare ? `、產值抽成 ${c.rule.revenueShare}%` : ''}（到「方案與課程 → 教練」修改）</p>
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-400 text-left"><th className="font-normal py-1">時間</th><th className="font-normal">課程</th><th className="font-normal text-right">出席</th><th className="font-normal text-right">產值</th><th className="font-normal text-right">薪資</th></tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {c.detail.map((d) => <tr key={d.sessionId}><td className="py-1 text-gray-600">{dateTime(d.startsAt)}</td><td className="text-gray-600">{d.className}</td><td className="text-right text-gray-500">{d.heads}/{d.capacity}</td><td className="text-right text-gray-500">{d.value}</td><td className="text-right text-gray-800">{d.pay}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]"><div className="font-semibold text-gray-700">上課紀錄匯出</div><p className="text-xs text-gray-400">每一筆預約、出席、未到與扣堂，可用 Excel 開啟</p></div>
        <input type="date" className="input w-auto text-sm" value={att.from} onChange={(e) => setAtt({ ...att, from: e.target.value })} aria-label="起" />
        <input type="date" className="input w-auto text-sm" value={att.to} onChange={(e) => setAtt({ ...att, to: e.target.value })} aria-label="迄" />
        <button className="btn-secondary flex items-center gap-1" onClick={() => downloadCsv(api, '/reports/export/attendance', att, 'attendance.csv')}><Download className="w-4 h-4" />匯出 CSV</button>
      </div>
    </div>
  );
}
