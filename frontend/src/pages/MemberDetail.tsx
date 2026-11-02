import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, CreditCard, MessageCircle, Snowflake, Sun, SlidersHorizontal, Copy } from 'lucide-react';
import api from '../api/client';
import Modal, { Field } from '../components/Modal';
import { BookingStatus, Coupon, Member, Membership, Plan } from '../types';
import { BOOKING_STATUS, CARRIER, INVOICE_STATUS, PASS_STATUS, PAY_METHOD, PLAN_KIND, dateStr, dateTime, localDay, money, passText } from '../lib/format';
import MemberForm from './MemberForm';

interface HistoryRow { id: string; status: BookingStatus; creditsCharged: number; session: { id: string; startsAt: string; classType: { name: string; color: string }; coach: { name: string } | null } }
type Detail = Member & {
  memberships: Membership[]; bookings: HistoryRow[]; lineBoundAt?: string | null;
  referredBy: { id: string; name: string } | null; referrals: { id: string; name: string }[]; coupons: Coupon[];
  suspendedUntil: string | null; violations: { count: number; windowDays: number; limit: number }; termsOutdated: boolean; termsAcceptedAt: string | null;
};

export default function MemberDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [m, setM] = useState<Detail | null>(null);
  const [modal, setModal] = useState<'edit' | 'sell' | { freeze: Membership } | { adjust: Membership } | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const load = () => api.get(`/members/${id}`).then((r) => setM(r.data));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return <div className="text-gray-400 text-sm">載入中…</div>;

  const close = () => { setModal(null); load(); };
  async function remove() {
    if (!confirm(`確定刪除會員「${m!.name}」？`)) return;
    await api.delete(`/members/${m!.id}`);
    navigate('/members');
  }
  async function unfreeze(p: Membership) {
    if (!confirm('提前解除凍結？未使用的凍結天數會從到期日扣回。')) return;
    await api.post(`/memberships/${p.id}/unfreeze`); load();
  }
  async function unbind() {
    if (!confirm('解除 LINE 綁定？會員將不再收到提醒。')) return;
    await api.delete(`/members/${m!.id}/line`); load();
  }
  const current = m.memberships.filter((p) => ['ACTIVE', 'FROZEN'].includes(p.status) && p.endDate.slice(0, 10) >= localDay());
  const past = m.memberships.filter((p) => !current.includes(p));
  const attended = m.bookings.filter((b) => b.status === 'ATTENDED').length;

  return (
    <div className="space-y-4">
      <Link to="/members" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600"><ArrowLeft className="w-4 h-4" />會員列表</Link>
      <div className="card flex flex-wrap items-start gap-4">
        <div className="w-14 h-14 rounded-full bg-brand/10 text-brand flex items-center justify-center text-xl font-bold">{m.name.charAt(0)}</div>
        <div className="flex-1 min-w-[12rem]">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-800">{m.name}</h1>
            {m.status === 'INACTIVE' && <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">停用</span>}
          </div>
          <div className="text-sm text-gray-500 mt-0.5">{m.phone}{m.email ? `・${m.email}` : ''}</div>
          <div className="text-xs text-gray-400 mt-1 space-x-2">
            {m.birthday && <span>生日 {dateStr(m.birthday)}</span>}
            {m.emergencyContact && <span>緊急聯絡 {m.emergencyContact}</span>}
            <span>累計出席 {attended} 堂</span>
          </div>
          {m.note && <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mt-2 whitespace-pre-wrap">{m.note}</div>}
          <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
            {m.suspendedUntil && <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-full">未到 {m.violations.count} 次，線上預約暫停至 {dateTime(m.suspendedUntil)}</span>}
            {!m.suspendedUntil && m.violations.count > 0 && <span className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">近 {m.violations.windowDays} 天未到 {m.violations.count} 次{m.violations.limit ? `（上限 ${m.violations.limit}）` : ''}</span>}
            {m.termsOutdated && <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">尚未同意最新版條款</span>}
            {!m.termsOutdated && m.termsAcceptedAt && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">已同意條款 {dateStr(m.termsAcceptedAt)}</span>}
            {m.invoiceCarrierType && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">發票：{CARRIER[m.invoiceCarrierType]}{m.invoiceCarrierNum ? ` ${m.invoiceCarrierNum}` : ''}{m.invoiceTaxId ? ` ${m.invoiceTaxId}` : ''}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-1" onClick={() => setModal('edit')}><Pencil className="w-4 h-4" />編輯</button>
          <button className="btn-secondary px-2" aria-label="刪除會員" onClick={remove}><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 text-sm">
          <MessageCircle className={`w-4 h-4 ${m.lineBound ? 'text-green-500' : 'text-gray-300'}`} />
          {m.lineBound ? (
            <>
              <span className="text-gray-700">已綁定 LINE{m.lineDisplayName ? `（${m.lineDisplayName}）` : ''}</span>
              <button className="ml-auto text-xs text-gray-400 hover:text-red-500" onClick={unbind}>解除綁定</button>
            </>
          ) : (
            <>
              <span className="text-gray-500">尚未綁定 LINE</span>
              <button className="ml-auto btn-secondary text-xs py-1" onClick={async () => setCode((await api.post(`/members/${m.id}/binding-code`)).data)}>產生綁定碼</button>
            </>
          )}
        </div>
        {code && (
          <div className="mt-3 rounded-xl bg-gray-50 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl tracking-[0.3em] font-bold text-gray-800">{code.code}</span>
              <button className="p-1 rounded hover:bg-gray-200" aria-label="複製" onClick={() => navigator.clipboard?.writeText(code.code)}><Copy className="w-4 h-4 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500 mt-1">請會員在教室的 LINE 官方帳號輸入這組代碼完成綁定，或到 <span className="font-mono">{location.origin}/m</span> 輸入代碼登入自己預約。24 小時內有效。</p>
          </div>
        )}
      </div>

      <div className="card text-sm space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">推薦碼</span>
          {m.referralCode ? <span className="font-mono font-semibold text-gray-800">{m.referralCode}</span>
            : <button className="btn-secondary text-xs py-1" onClick={async () => { await api.post(`/members/${m.id}/referral-code`); load(); }}>產生推薦碼</button>}
          {m.referredBy && <span className="text-gray-500 sm:ml-4">介紹人：<Link to={`/members/${m.referredBy.id}`} className="text-brand">{m.referredBy.name}</Link></span>}
        </div>
        {m.referrals.length > 0 && <div className="text-gray-500">已介紹 {m.referrals.length} 位：{m.referrals.map((r, i) => <span key={r.id}>{i ? '、' : ''}<Link to={`/members/${r.id}`} className="text-brand">{r.name}</Link></span>)}</div>}
        {m.coupons.length > 0 && <div className="text-gray-500">專屬折價券：{m.coupons.map((c) => <span key={c.id} className={`ml-1 font-mono text-xs px-1.5 py-0.5 rounded ${c.usedCount ? 'bg-gray-100 text-gray-400 line-through' : 'bg-brand/10 text-brand'}`}>{c.code} {money(c.value)}</span>)}</div>}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700">方案</h2>
          <button className="btn-primary flex items-center gap-1 text-sm" onClick={() => setModal('sell')}><CreditCard className="w-4 h-4" />售卡</button>
        </div>
        {current.length === 0 && <p className="text-sm text-gray-400">目前沒有有效方案。</p>}
        <div className="space-y-2">
          {current.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800">{p.planName}</span>
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded">{PLAN_KIND[p.kind]}</span>
                {p.status === 'FROZEN' && <span className="text-xs bg-sky-50 text-sky-600 px-1.5 rounded">凍結至 {dateStr(p.frozenUntil)}</span>}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {p.kind === 'PERIOD' ? '不限堂數' : <><span className="text-lg font-bold text-brand">{p.creditsLeft}</span> / {p.creditsTotal} 堂</>}
                <span className="text-gray-400">・{dateStr(p.startDate)} ~ {dateStr(p.endDate)}</span>
              </div>
              {p.frozenFrom && p.status !== 'FROZEN' && p.frozenUntil && p.frozenUntil.slice(0, 10) >= localDay() && (
                <div className="text-xs text-sky-600 mt-1">已排定凍結 {dateStr(p.frozenFrom)} ~ {dateStr(p.frozenUntil)}</div>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                {p.frozenFrom && p.frozenUntil && p.frozenUntil.slice(0, 10) >= localDay()
                  ? <button className="btn-secondary text-xs py-1 flex items-center gap-1" onClick={() => unfreeze(p)}><Sun className="w-3.5 h-3.5" />解除凍結</button>
                  : <button className="btn-secondary text-xs py-1 flex items-center gap-1" onClick={() => setModal({ freeze: p })}><Snowflake className="w-3.5 h-3.5" />凍結</button>}
                <button className="btn-secondary text-xs py-1 flex items-center gap-1" onClick={() => setModal({ adjust: p })}><SlidersHorizontal className="w-3.5 h-3.5" />調整</button>
              </div>
            </div>
          ))}
        </div>
        {past.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-400 cursor-pointer">過去的方案（{past.length}）</summary>
            <div className="divide-y divide-gray-50 mt-2">
              {past.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-gray-600">{p.planName}<span className="text-xs text-gray-400 ml-2">{dateStr(p.startDate)} ~ {dateStr(p.endDate)}</span></span>
                  <span className="text-xs text-gray-400">{p.status === 'ACTIVE' ? '已到期' : PASS_STATUS[p.status]}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-3">上課紀錄</h2>
        {m.bookings.length === 0 ? <p className="text-sm text-gray-400">還沒有預約紀錄。</p> : (
          <div className="divide-y divide-gray-50">
            {m.bookings.map((b) => (
              <Link key={b.id} to={`/schedule?session=${b.session.id}`} className="flex items-center gap-3 py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
                <span className="w-1.5 h-8 rounded-full" style={{ background: b.session.classType.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">{b.session.classType.name}</div>
                  <div className="text-xs text-gray-400">{dateTime(b.session.startsAt)}{b.session.coach ? `・${b.session.coach.name}` : ''}</div>
                </div>
                {b.creditsCharged > 0 && <span className="text-xs text-gray-400">扣 {b.creditsCharged} 堂</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${BOOKING_STATUS[b.status].cls}`}>{BOOKING_STATUS[b.status].label}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-3">購買紀錄</h2>
        {m.memberships.length === 0 ? <p className="text-sm text-gray-400">沒有購買紀錄。</p> : (
          <div className="divide-y divide-gray-50">
            {m.memberships.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="text-gray-700">{p.planName}</span><span className="text-xs text-gray-400 ml-2">{dateStr(p.paidAt)}・{PAY_METHOD[p.payMethod]}{p.discount ? `・折抵 ${p.discount}` : ''}</span>
                  {p.invoiceStatus && <div className={`text-xs ${p.invoiceStatus === 'FAILED' ? 'text-red-500' : 'text-gray-400'}`}>發票{INVOICE_STATUS[p.invoiceStatus]}{p.invoiceNo ? ` ${p.invoiceNo}` : ''}{p.invoiceError && p.invoiceStatus === 'FAILED' ? `：${p.invoiceError}` : ''}</div>}
                </div>
                <span className={p.status === 'CANCELLED' ? 'line-through text-gray-400' : 'text-gray-700'}>{money(p.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal === 'edit' && <MemberForm member={m} onClose={() => setModal(null)} onSaved={close} />}
      {modal === 'sell' && <SellForm memberId={m.id} onClose={() => setModal(null)} onSaved={close} />}
      {modal && typeof modal === 'object' && 'freeze' in modal && <FreezeForm p={modal.freeze} onClose={() => setModal(null)} onSaved={close} />}
      {modal && typeof modal === 'object' && 'adjust' in modal && <AdjustForm p={modal.adjust} onClose={() => setModal(null)} onSaved={close} />}
    </div>
  );
}

export function SellForm({ memberId, onClose, onSaved }: { memberId: string; onClose: () => void; onSaved: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [f, setF] = useState({ planId: '', startDate: localDay(), price: '', payMethod: 'CASH', note: '', couponCode: '' });
  const [couponMsg, setCouponMsg] = useState('');
  useEffect(() => { api.get('/plans').then((r) => { const a = r.data.filter((p: Plan) => p.active); setPlans(a); if (a[0]) setF((x) => ({ ...x, planId: a[0].id, price: String(a[0].price) })); }); }, []);
  const plan = plans.find((p) => p.id === f.planId);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/memberships', { memberId, planId: f.planId, startDate: f.startDate, price: +f.price, payMethod: f.payMethod, note: f.note || undefined, couponCode: f.couponCode || undefined });
    onSaved();
  }
  return (
    <Modal title="售卡" onClose={onClose}>
      {plans.length === 0 ? <p className="text-sm text-gray-500">還沒有可販售的方案，請先到「<Link to="/catalog" className="text-brand">方案與課程</Link>」建立。</p> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="方案">
            <select className="input" value={f.planId} onChange={(e) => { const p = plans.find((x) => x.id === e.target.value); setF((x) => ({ ...x, planId: e.target.value, price: String(p?.price ?? '') })); }}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}（{money(p.price)}）</option>)}
            </select>
          </Field>
          {plan && <p className="text-xs text-gray-500 -mt-1">{PLAN_KIND[plan.kind]}・{plan.kind === 'PERIOD' ? `期間不限堂數${plan.dailyLimit ? `（每日最多 ${plan.dailyLimit} 堂）` : ''}` : `${plan.credits} 堂`}・{plan.validDays} 天內有效</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日期"><input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} required /></Field>
            <Field label="實收金額"><input type="number" min={0} className="input" value={f.price} onChange={(e) => set('price', e.target.value)} required /></Field>
          </div>
          <Field label="折價券（選填）" hint={couponMsg || undefined}>
            <div className="flex gap-2">
              <input className="input font-mono uppercase" value={f.couponCode} onChange={(e) => { set('couponCode', e.target.value.toUpperCase()); setCouponMsg(''); }} placeholder="輸入代碼" />
              <button type="button" className="btn-secondary whitespace-nowrap" disabled={!f.couponCode} onClick={async () => {
                try {
                  const r = await api.post('/memberships/quote', { memberId, planId: f.planId, code: f.couponCode });
                  setF((x) => ({ ...x, price: String(r.data.amount) })); setCouponMsg(`${r.data.name}：折抵 ${money(r.data.discount)}，實收已更新`);
                } catch { setCouponMsg(''); }
              }}>套用</button>
            </div>
          </Field>
          <Field label="付款方式"><select className="input" value={f.payMethod} onChange={(e) => set('payMethod', e.target.value)}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="備註"><input className="input" value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="例如：舊生優惠" /></Field>
          <button className="btn-primary w-full">確認售出</button>
        </form>
      )}
    </Modal>
  );
}

function FreezeForm({ p, onClose, onSaved }: { p: Membership; onClose: () => void; onSaved: () => void }) {
  const [from, setFrom] = useState(localDay());
  const [until, setUntil] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/memberships/${p.id}/freeze`, { from, until });
    onSaved();
  }
  return (
    <Modal title={`凍結「${p.planName}」`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} required /></Field>
          <Field label="結束（含）"><input type="date" className="input" min={from} value={until} onChange={(e) => setUntil(e.target.value)} required /></Field>
        </div>
        <p className="text-xs text-gray-500">凍結期間無法預約；凍結天數會加到到期日（目前 {dateStr(p.endDate)}）。</p>
        <button className="btn-primary w-full">確認凍結</button>
      </form>
    </Modal>
  );
}

function AdjustForm({ p, onClose, onSaved }: { p: Membership; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ creditsLeft: String(p.creditsLeft ?? ''), endDate: dateStr(p.endDate), note: p.note ?? '' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.put(`/memberships/${p.id}`, { ...(p.kind === 'PERIOD' ? {} : { creditsLeft: +f.creditsLeft }), endDate: f.endDate, note: f.note || null });
    onSaved();
  }
  async function voidPass() {
    if (!confirm(`作廢「${p.planName}」？作廢後無法再使用，營收也不再計入。`)) return;
    await api.put(`/memberships/${p.id}`, { status: 'CANCELLED' });
    onSaved();
  }
  return (
    <Modal title={`調整「${p.planName}」`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-gray-500">{passText(p)}</p>
        <div className="grid grid-cols-2 gap-3">
          {p.kind !== 'PERIOD' && <Field label="剩餘堂數"><input type="number" min={0} className="input" value={f.creditsLeft} onChange={(e) => setF({ ...f, creditsLeft: e.target.value })} /></Field>}
          <Field label="到期日"><input type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <Field label="備註" hint="例如：補償停課 1 堂"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <button className="btn-primary w-full">儲存</button>
        <button type="button" className="btn-danger w-full" onClick={voidPass}>作廢此方案</button>
      </form>
    </Modal>
  );
}
