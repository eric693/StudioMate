import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Send, MessageCircle } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import Modal, { Field } from '../components/Modal';
import SearchBox from '../components/SearchBox';
import { Coupon, Plan } from '../types';
import { dateStr, dateTime, money } from '../lib/format';

type Tab = 'coupons' | 'campaigns' | 'referrals';

export default function Marketing() {
  const [tab, setTab] = useState<Tab>('coupons');
  return (
    <div className="space-y-4">
      <div className="page-header"><div><h1 className="text-xl font-bold text-gray-800">行銷</h1><p className="text-sm text-gray-400">折價券、群發訊息與轉介紹</p></div></div>
      <HowTo module="marketing" />
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['coupons', '折價券'], ['campaigns', '群發訊息'], ['referrals', '轉介紹']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'coupons' && <Coupons />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'referrals' && <Referrals />}
    </div>
  );
}

const couponValue = (c: Pick<Coupon, 'discountType' | 'value'>) => (c.discountType === 'AMOUNT' ? `折 ${money(c.value)}` : `${100 - c.value} 折`.replace(/0 折$/, ' 折'));

function Coupons() {
  const [list, setList] = useState<Coupon[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const load = () => api.get('/coupons', { params: { q, status } }).then((r) => setList(r.data));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/plans').then((r) => setPlans(r.data)); }, []);
  async function remove(c: Coupon) {
    if (!confirm(`刪除折價券「${c.code}」？`)) return;
    await api.delete(`/coupons/${c.id}`); load();
  }
  const planName = (ids: string[]) => ids.map((i) => plans.find((p) => p.id === i)?.name).filter(Boolean).join('、');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={q} onChange={setQ} placeholder="搜尋代碼或名稱" />
        <select className="input w-auto text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="狀態">
          <option value="">全部</option><option value="active">使用中</option><option value="inactive">已停用</option><option value="personal">會員專屬（轉介紹獎勵）</option>
        </select>
        <button className="btn-primary flex items-center gap-1 ml-auto" onClick={() => setEditing('new')}><Plus className="w-4 h-4" />新增折價券</button>
      </div>
      <div className="card p-0 overflow-hidden">
        {list.length === 0 ? <p className="text-sm text-gray-400 p-4">{q || status ? '沒有符合條件的折價券。' : '還沒有折價券。例如開幕優惠 OPEN500、老學員回流九折。'}</p> : (
          <div className="divide-y divide-gray-50">
            {list.map((c) => (
              <div key={c.id} className={`flex items-center gap-3 px-4 py-3 ${c.active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800">
                    <span className="font-mono font-semibold">{c.code}</span><span className="ml-2">{c.name}</span>
                    <span className="text-[11px] bg-brand/10 text-brand px-1.5 rounded ml-2">{couponValue(c)}</span>
                    {!c.active && <span className="text-[11px] text-gray-400 ml-2">停用</span>}
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    已用 {c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ''} 次・每人 {c.perMemberLimit} 次
                    {c.minAmount ? `・滿 ${money(c.minAmount)}` : ''}{c.planIds.length ? `・限 ${planName(c.planIds)}` : ''}
                    {c.newMemberOnly ? '・限首購' : ''}{c.memberName ? `・限 ${c.memberName}` : ''}
                    {c.validFrom || c.validTo ? `・${dateStr(c.validFrom) || '即日起'} ~ ${dateStr(c.validTo) || '無期限'}` : ''}
                  </div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" onClick={() => setEditing(c)}><Pencil className="w-4 h-4 text-gray-400" /></button>
                {c.usedCount === 0 && <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" onClick={() => remove(c)}><Trash2 className="w-4 h-4 text-gray-400" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <CouponForm c={editing === 'new' ? null : editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function CouponForm({ c, plans, onClose, onSaved }: { c: Coupon | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: c?.code ?? '', name: c?.name ?? '', discountType: c?.discountType ?? 'AMOUNT', value: String(c?.value ?? ''),
    minAmount: String(c?.minAmount ?? 0), maxUses: c?.maxUses ? String(c.maxUses) : '', perMemberLimit: String(c?.perMemberLimit ?? 1),
    validFrom: dateStr(c?.validFrom), validTo: dateStr(c?.validTo), planIds: c?.planIds ?? [], newMemberOnly: c?.newMemberOnly ?? false,
    active: c?.active ?? true, note: c?.note ?? '',
  });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      ...f, value: +f.value, minAmount: +f.minAmount || 0, maxUses: f.maxUses ? +f.maxUses : null, perMemberLimit: +f.perMemberLimit || 1,
      validFrom: f.validFrom || null, validTo: f.validTo || null, note: f.note || null,
    };
    if (c) await api.put(`/coupons/${c.id}`, body); else await api.post('/coupons', body);
    onSaved();
  }
  return (
    <Modal title={c ? '編輯折價券' : '新增折價券'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="代碼" hint="會員結帳時輸入"><input className="input font-mono uppercase" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} required placeholder="OPEN500" /></Field>
          <Field label="名稱"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required placeholder="開幕優惠" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="折扣方式"><select className="input" value={f.discountType} onChange={(e) => set('discountType', e.target.value)}><option value="AMOUNT">折抵金額</option><option value="PERCENT">打折（百分比）</option></select></Field>
          <Field label={f.discountType === 'AMOUNT' ? '折抵金額' : '折扣 %'} hint={f.discountType === 'PERCENT' ? '例如 10＝打九折' : undefined}>
            <input type="number" min={1} max={f.discountType === 'PERCENT' ? 100 : undefined} className="input" value={f.value} onChange={(e) => set('value', e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="最低消費"><input type="number" min={0} className="input" value={f.minAmount} onChange={(e) => set('minAmount', e.target.value)} /></Field>
          <Field label="總使用次數" hint="空白＝不限"><input type="number" min={1} className="input" value={f.maxUses} onChange={(e) => set('maxUses', e.target.value)} /></Field>
          <Field label="每人可用"><input type="number" min={1} className="input" value={f.perMemberLimit} onChange={(e) => set('perMemberLimit', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始日期"><input type="date" className="input" value={f.validFrom} onChange={(e) => set('validFrom', e.target.value)} /></Field>
          <Field label="結束日期"><input type="date" className="input" value={f.validTo} onChange={(e) => set('validTo', e.target.value)} /></Field>
        </div>
        {plans.length > 0 && (
          <Field label="適用方案" hint="都不勾＝全部方案">
            <div className="flex flex-wrap gap-2">
              {plans.map((p) => (
                <button type="button" key={p.id} onClick={() => set('planIds', f.planIds.includes(p.id) ? f.planIds.filter((i) => i !== p.id) : [...f.planIds, p.id])}
                  className={`px-3 py-1 rounded-full text-xs border ${f.planIds.includes(p.id) ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-500'}`}>{p.name}</button>
              ))}
            </div>
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.newMemberOnly} onChange={(e) => set('newMemberOnly', e.target.checked)} />限沒有購買紀錄的新會員</label>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />使用中</label>
        <Field label="備註"><input className="input" value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

const SEGMENTS: Record<string, { label: string; days?: string; def?: number }> = {
  inactive: { label: '久未上課', days: '幾天沒來上課', def: 30 },
  expiring: { label: '方案即將到期', days: '幾天內到期', def: 14 },
  lowCredit: { label: '堂數快用完' },
  expired: { label: '方案已過期未續約', days: '過期幾天內', def: 60 },
  noPass: { label: '沒有有效方案' },
  newMember: { label: '新會員（未上過課）' },
  birthday: { label: '本月壽星' },
  all: { label: '所有使用中會員' },
};
interface SegMember { id: string; name: string; phone: string; lineBound: boolean; lastAttended: string | null; passes: { planName: string }[] }
interface Campaign { id: string; name: string; segment: string; message: string; total: number; sent: number; sandbox: number; skipped: number; createdAt: string }

function Campaigns() {
  const [segment, setSegment] = useState('inactive');
  const [days, setDays] = useState(30);
  const [lineOnly, setLineOnly] = useState(false);
  const [members, setMembers] = useState<SegMember[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [message, setMessage] = useState('{name} 您好，好久不見！本週回來上課享老學員優惠，歡迎預約 💪');
  const [history, setHistory] = useState<Campaign[]>([]);
  const [hq, setHq] = useState('');
  const [msg, setMsg] = useState('');
  const seg = SEGMENTS[segment];
  useEffect(() => {
    setMembers(null);
    api.get('/marketing/segment', { params: { segment, days: seg.days ? days : undefined, lineOnly: lineOnly || undefined } })
      .then((r) => { setMembers(r.data); setPicked(new Set(r.data.filter((m: SegMember) => m.lineBound).map((m: SegMember) => m.id))); });
  }, [segment, days, lineOnly, seg.days]);
  const loadHistory = () => api.get('/campaigns', { params: { q: hq } }).then((r) => setHistory(r.data));
  useEffect(() => { const t = setTimeout(loadHistory, 250); return () => clearTimeout(t); }, [hq]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!picked.size) return;
    if (!confirm(`發送給 ${picked.size} 位會員？訊息送出後無法收回。`)) return;
    const r = await api.post('/campaigns', { segment, days: seg.days ? days : undefined, lineOnly, name: name || seg.label, message, memberIds: [...picked] });
    setMsg(`已處理 ${r.data.total} 位：送出 ${r.data.sent}、沙盒記錄 ${r.data.sandbox}、略過 ${r.data.skipped}（未綁定 LINE）`);
    loadHistory();
  }
  async function removeHistory(c: Campaign) {
    if (!confirm('刪除這筆群發紀錄？（已送出的訊息不會收回）')) return;
    await api.delete(`/campaigns/${c.id}`); loadHistory();
  }
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-700">1. 選擇名單</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="條件"><select className="input w-auto" value={segment} onChange={(e) => { setSegment(e.target.value); if (SEGMENTS[e.target.value].def) setDays(SEGMENTS[e.target.value].def!); }}>
            {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></Field>
          {seg.days && <Field label={seg.days}><input type="number" min={1} className="input w-24" value={days} onChange={(e) => setDays(+e.target.value || 1)} /></Field>}
          <label className="flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={lineOnly} onChange={(e) => setLineOnly(e.target.checked)} />只看已綁定 LINE</label>
        </div>
        {!members ? <p className="text-sm text-gray-400">載入中…</p> : members.length === 0 ? <p className="text-sm text-gray-400">沒有符合條件的會員。</p> : (
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 border border-gray-100 rounded-xl">
            {members.map((m) => (
              <label key={m.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${m.lineBound ? 'cursor-pointer' : 'opacity-50'}`}>
                <input type="checkbox" disabled={!m.lineBound} checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                <Link to={`/members/${m.id}`} className="font-medium text-gray-800 hover:text-brand">{m.name}</Link>
                <span className="text-xs text-gray-400">{m.phone}</span>
                {m.lineBound ? <MessageCircle className="w-3.5 h-3.5 text-green-500" /> : <span className="text-[11px] text-gray-400">未綁定 LINE</span>}
                <span className="ml-auto text-xs text-gray-400 truncate">{m.lastAttended ? `最後上課 ${dateStr(m.lastAttended)}` : '尚未上課'}{m.passes.length ? `・${m.passes[0].planName}` : ''}</span>
              </label>
            ))}
          </div>
        )}
        {members && members.length > 0 && <p className="text-xs text-gray-400">共 {members.length} 位，已勾選 {picked.size} 位（沒有綁定 LINE 的會員無法接收）</p>}
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-700">2. 撰寫訊息</h2>
        <Field label="活動名稱" hint="只用於紀錄"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={seg.label} /></Field>
        <Field label="訊息內容" hint="{name} 會自動換成會員姓名；可附上折價券代碼"><textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} /></Field>
        {msg && <div className="text-sm bg-green-50 text-green-700 rounded-xl px-3 py-2">{msg}</div>}
        <button className="btn-primary flex items-center gap-1" disabled={!picked.size || !message.trim()} onClick={send}><Send className="w-4 h-4" />發送給 {picked.size} 位</button>
      </div>
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold text-gray-700">群發紀錄</h2>
          <SearchBox value={hq} onChange={setHq} placeholder="搜尋活動名稱或內容" />
        </div>
        {history.length === 0 ? <p className="text-sm text-gray-400">{hq ? '沒有符合的紀錄。' : '還沒有群發紀錄。'}</p> : (
          <div className="divide-y divide-gray-50">
            {history.map((c) => (
              <div key={c.id} className="py-2 flex gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800">{c.name}<span className="text-xs text-gray-400 ml-2">{c.segment}・{dateTime(c.createdAt)}</span></div>
                  <div className="text-xs text-gray-500 truncate">{c.message}</div>
                  <div className="text-xs text-gray-400">共 {c.total} 位・送出 {c.sent}・沙盒 {c.sandbox}・略過 {c.skipped}</div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-gray-50 self-start" aria-label="刪除紀錄" onClick={() => removeHistory(c)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface Referrer { id: string; name: string; phone: string; referralCode: string | null; count: number; converted: number; referred: { id: string; name: string; purchased: boolean }[] }

function Referrals() {
  const [list, setList] = useState<Referrer[]>([]);
  const [reward, setReward] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => {
    api.get('/marketing/referrals').then((r) => setList(r.data));
    api.get('/studio').then((r) => setReward(r.data.referralRewardAmount));
  }, []);
  const shown = list.filter((r) => !q || [r.name, r.phone, r.referralCode, ...r.referred.map((x) => x.name)].some((v) => v?.includes(q)));
  return (
    <div className="space-y-3">
      <div className="card text-sm text-gray-600 space-y-1">
        <div>會員在手機網頁「我的」可以看到自己的推薦碼；新會員入會時，櫃檯在會員資料填入推薦碼即可建立介紹關係。</div>
        <div>{reward ? <>被介紹的新會員<b>首次購買</b>後，介紹人自動獲得 <b>{money(reward)}</b> 專屬折價券並收到 LINE 通知。</> : <>目前沒有設定獎勵，可到「<Link to="/settings" className="text-brand">教室設定 → 線上購買與發票</Link>」設定轉介紹獎勵金額。</>}</div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="搜尋介紹人或被介紹人" />
      <div className="card p-0 overflow-hidden">
        {shown.length === 0 ? <p className="text-sm text-gray-400 p-4">{q ? '沒有符合的紀錄。' : '還沒有轉介紹紀錄。'}</p> : (
          <div className="divide-y divide-gray-50">
            {shown.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <Link to={`/members/${r.id}`} className="font-medium text-gray-800 hover:text-brand">{r.name}</Link>
                  <span className="text-xs font-mono text-gray-400">{r.referralCode}</span>
                  <span className="ml-auto text-xs text-gray-500">介紹 {r.count} 位・已購買 {r.converted} 位</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {r.referred.map((x) => <Link key={x.id} to={`/members/${x.id}`} className={`text-xs px-2 py-0.5 rounded-full ${x.purchased ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{x.name}{x.purchased ? ' ✓' : ''}</Link>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
