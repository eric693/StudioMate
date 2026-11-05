import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import SearchBox, { matches } from '../components/SearchBox';
import Modal, { Field } from '../components/Modal';
import { ClassType, Coach, Plan, PlanKind } from '../types';
import { PLAN_KIND, money } from '../lib/format';

const COLORS = ['#d9573b', '#e8a33d', '#4f9d69', '#3b82c4', '#7c5cc4', '#c45c9a', '#5f6b7a', '#0f9d9a'];
type Tab = 'plans' | 'types' | 'coaches';

export default function Catalog() {
  const [tab, setTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [types, setTypes] = useState<ClassType[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [editing, setEditing] = useState<{ tab: Tab; item: Plan | ClassType | Coach | null } | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState<'' | 'on' | 'off'>('');
  const [kind, setKind] = useState<'' | PlanKind>('');
  const [typeFilter, setTypeFilter] = useState('');
  const okActive = (a: boolean) => !active || (active === 'on') === a;
  const load = () => Promise.all([
    api.get('/plans').then((r) => setPlans(r.data)),
    api.get('/class-types').then((r) => setTypes(r.data)),
    api.get('/coaches').then((r) => setCoaches(r.data)),
  ]);
  useEffect(() => { load(); }, []);

  async function remove(path: string, id: string, name: string) {
    if (!confirm(`刪除「${name}」？`)) return;
    await api.delete(`/${path}/${id}`);
    load();
  }
  const typeName = (ids: string[]) => ids.map((i) => types.find((t) => t.id === i)?.name).filter(Boolean).join('、');
  const shownPlans = plans.filter((p) => okActive(p.active) && (!kind || p.kind === kind)
    && (!typeFilter || p.classTypeIds.length === 0 || p.classTypeIds.includes(typeFilter))
    && matches(q, p.name, PLAN_KIND[p.kind], p.price, typeName(p.classTypeIds)));
  const shownTypes = types.filter((t) => okActive(t.active) && matches(q, t.name));
  const shownCoaches = coaches.filter((c) => okActive(c.active) && matches(q, c.name, c.phone));
  const total = { plans: plans.length, types: types.length, coaches: coaches.length }[tab];
  const count = { plans: shownPlans.length, types: shownTypes.length, coaches: shownCoaches.length }[tab];
  const TABS: [Tab, string, number][] = [['plans', '方案', plans.length], ['types', '課程類型', types.length], ['coaches', '教練', coaches.length]];

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-800">方案與課程</h1><p className="text-sm text-gray-400">販售的方案、課程類型與教練</p></div>
        <div><button className="btn-primary flex items-center gap-1" onClick={() => setEditing({ tab, item: null })}><Plus className="w-4 h-4" />新增{TABS.find((t) => t[0] === tab)![1]}</button></div>
      </div>
      <HowTo module="catalog" />
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(([k, label, n]) => (
          <button key={k} onClick={() => { setTab(k); setQ(''); setKind(''); setTypeFilter(''); }} className={`px-4 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{label}<span className="text-xs text-gray-400 ml-1">{n}</span></button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={q} onChange={setQ} placeholder={tab === 'plans' ? '搜尋方案名稱、價格、課程' : tab === 'types' ? '搜尋課程名稱' : '搜尋姓名、電話'} />
        <select className="input w-auto text-sm" value={active} onChange={(e) => setActive(e.target.value as typeof active)} aria-label="狀態">
          <option value="">全部狀態</option><option value="on">{tab === 'plans' ? '販售中' : tab === 'types' ? '開課中' : '在職'}</option><option value="off">{tab === 'plans' ? '停售' : tab === 'types' ? '停用' : '離職'}</option>
        </select>
        {tab === 'plans' && <>
          <select className="input w-auto text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="方案類型">
            <option value="">全部類型</option>{Object.entries(PLAN_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input w-auto text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="可上課程">
            <option value="">可上任何課程</option>{types.map((t) => <option key={t.id} value={t.id}>可上「{t.name}」</option>)}
          </select>
        </>}
        {count !== total && <span className="text-xs text-gray-400">符合 {count} / {total}</span>}
      </div>

      <div className="card p-0 overflow-hidden">
        {tab === 'plans' && (plans.length === 0 ? <Empty text="還沒有方案。常見的有：10 堂卡（90 天）、月卡（30 天不限堂數）、單堂體驗。" /> : shownPlans.length === 0 ? <Empty text="沒有符合條件的方案。" /> : (
          <div className="divide-y divide-gray-50">
            {shownPlans.map((p) => (
              <Row key={p.id} inactive={!p.active} onEdit={() => setEditing({ tab, item: p })} onDelete={() => remove('plans', p.id, p.name)}
                title={<>{p.name}<span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded ml-2">{PLAN_KIND[p.kind]}</span>
                  {p.onlineSale && <span className="text-xs bg-green-50 text-green-600 px-1.5 rounded ml-1">線上販售</span>}
                  {p.trialOnly && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 rounded ml-1">體驗</span>}
                  {p.recurring && <span className="text-xs bg-sky-50 text-sky-600 px-1.5 rounded ml-1">月扣</span>}
                  {!p.active && <span className="text-xs text-gray-400 ml-2">停售</span>}</>}
                sub={`${p.kind === 'PERIOD' ? `不限堂數${p.dailyLimit ? `・每日 ${p.dailyLimit} 堂` : ''}` : `${p.credits} 堂`}・${p.validDays} 天有效${p.classTypeIds.length ? `・限 ${typeName(p.classTypeIds)}` : ''}`}
                right={<span className="font-semibold text-gray-700">{money(p.price)}</span>} />
            ))}
          </div>
        ))}
        {tab === 'types' && (types.length === 0 ? <Empty text="還沒有課程類型，例如：哈達瑜珈、空中瑜珈、拳擊有氧、街舞入門。" /> : shownTypes.length === 0 ? <Empty text="沒有符合條件的課程類型。" /> : (
          <div className="divide-y divide-gray-50">
            {shownTypes.map((t) => (
              <Row key={t.id} inactive={!t.active} color={t.color} onEdit={() => setEditing({ tab, item: t })} onDelete={() => remove('class-types', t.id, t.name)}
                title={<>{t.name}{t.isPrivate && <span className="text-xs bg-purple-50 text-purple-600 px-1.5 rounded ml-2">私人課</span>}
                  {t.isOnline && <span className="text-xs bg-sky-50 text-sky-600 px-1.5 rounded ml-1">直播</span>}{!t.active && <span className="text-xs text-gray-400 ml-2">停用</span>}</>}
                sub={`${t.durationMin} 分鐘・預設 ${t.defaultCapacity} 人・每堂扣 ${t.creditCost} 堂`} />
            ))}
          </div>
        ))}
        {tab === 'coaches' && (coaches.length === 0 ? <Empty text="還沒有教練。" /> : shownCoaches.length === 0 ? <Empty text="沒有符合條件的教練。" /> : (
          <div className="divide-y divide-gray-50">
            {shownCoaches.map((c) => (
              <Row key={c.id} inactive={!c.active} color={c.color} onEdit={() => setEditing({ tab, item: c })} onDelete={() => remove('coaches', c.id, c.name)}
                title={<>{c.name}{!c.active && <span className="text-xs text-gray-400 ml-2">停用</span>}</>}
                sub={[c.phone, payRule(c), c._count?.availability ? `私人課時段 ${c._count.availability} 段` : ''].filter(Boolean).join('・')} />
            ))}
          </div>
        ))}
      </div>

      {editing?.tab === 'plans' && <PlanForm p={editing.item as Plan | null} types={types} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {editing?.tab === 'types' && <TypeForm t={editing.item as ClassType | null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {editing?.tab === 'coaches' && <CoachForm c={editing.item as Coach | null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

const payRule = (c: Coach) => [
  c.payPerClass ? `每堂 ${c.payPerClass}` : '', c.payPerHead ? `超過 ${c.headThreshold} 人每人 +${c.payPerHead}` : '', c.shareTiers?.length ? `階梯抽成 ${c.shareTiers.map((t) => `${t.rate}%`).join('→')}` : c.revenueShare ? `抽成 ${c.revenueShare}%` : '',
].filter(Boolean).join('、');

const Empty = ({ text }: { text: string }) => <p className="text-sm text-gray-400 p-4">{text}</p>;

function Row({ title, sub, right, color, inactive, onEdit, onDelete }: { title: React.ReactNode; sub: string; right?: React.ReactNode; color?: string; inactive: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${inactive ? 'opacity-60' : ''}`}>
      {color && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{title}</div>
        {sub && <div className="text-xs text-gray-400 truncate">{sub}</div>}
      </div>
      {right}
      <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" onClick={onEdit}><Pencil className="w-4 h-4 text-gray-400" /></button>
      <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" onClick={onDelete}><Trash2 className="w-4 h-4 text-gray-400" /></button>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {COLORS.map((c) => (
        <button key={c} type="button" aria-label={c} onClick={() => onChange(c)} className={`w-7 h-7 rounded-full ${value === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`} style={{ background: c }} />
      ))}
    </div>
  );
}

function Active({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

function PlanForm({ p, types, onClose, onSaved }: { p: Plan | null; types: ClassType[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: p?.name ?? '', kind: (p?.kind ?? 'PACK') as PlanKind, credits: String(p?.credits ?? 10), validDays: String(p?.validDays ?? 90),
    price: String(p?.price ?? ''), dailyLimit: String(p?.dailyLimit ?? ''), classTypeIds: p?.classTypeIds ?? [], active: p?.active ?? true,
    onlineSale: p?.onlineSale ?? false, trialOnly: p?.trialOnly ?? false, description: p?.description ?? '', recurring: p?.recurring ?? false,
  });
  function setKind(kind: PlanKind) {
    setF((x) => ({ ...x, kind, ...(p ? {} : kind === 'PERIOD' ? { validDays: '30' } : kind === 'DROPIN' ? { validDays: '30' } : { validDays: '90' }) }));
  }
  const toggle = (id: string) => setF((x) => ({ ...x, classTypeIds: x.classTypeIds.includes(id) ? x.classTypeIds.filter((i) => i !== id) : [...x.classTypeIds, id] }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: f.name, kind: f.kind, validDays: +f.validDays, price: +f.price, classTypeIds: f.classTypeIds, active: f.active,
      onlineSale: f.onlineSale, trialOnly: f.trialOnly, description: f.description || null, recurring: f.kind === 'PERIOD' && f.recurring,
      credits: f.kind === 'PACK' ? +f.credits : null, dailyLimit: f.kind === 'PERIOD' && f.dailyLimit ? +f.dailyLimit : null,
    };
    if (p) await api.put(`/plans/${p.id}`, body); else await api.post('/plans', body);
    onSaved();
  }
  return (
    <Modal title={p ? '編輯方案' : '新增方案'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="方案名稱"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例如：瑜珈 10 堂卡" required /></Field>
        <Field label="類型">
          <div className="grid grid-cols-3 gap-2">
            {(['PACK', 'PERIOD', 'DROPIN'] as PlanKind[]).map((k) => (
              <button type="button" key={k} onClick={() => setKind(k)} className={`py-2 rounded-xl text-sm border ${f.kind === k ? 'border-brand bg-brand/5 text-brand font-medium' : 'border-gray-200 text-gray-500'}`}>{PLAN_KIND[k]}</button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          {f.kind === 'PACK' && <Field label="堂數"><input type="number" min={1} className="input" value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} required /></Field>}
          {f.kind === 'PERIOD' && <Field label="每日上限" hint="空白＝不限"><input type="number" min={1} className="input" value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: e.target.value })} /></Field>}
          <Field label="有效天數"><input type="number" min={1} className="input" value={f.validDays} onChange={(e) => setF({ ...f, validDays: e.target.value })} required /></Field>
          <Field label="售價"><input type="number" min={0} className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></Field>
        </div>
        {types.length > 0 && (
          <Field label="可使用的課程" hint="都不勾＝所有課程都能用">
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <button type="button" key={t.id} onClick={() => toggle(t.id)} className={`px-3 py-1 rounded-full text-xs border ${f.classTypeIds.includes(t.id) ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-500'}`}>{t.name}</button>
              ))}
            </div>
          </Field>
        )}
        <Field label="方案說明" hint="顯示在會員網頁的購買頁"><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="例如：適合每週上 1～2 堂的學員，可上所有團體課" /></Field>
        <Active value={f.active} onChange={(v) => setF({ ...f, active: v })} label="販售中" />
        <Active value={f.onlineSale} onChange={(v) => setF({ ...f, onlineSale: v })} label="開放會員在手機網頁購買" />
        <Active value={f.trialOnly} onChange={(v) => setF({ ...f, trialOnly: v })} label="體驗方案：限沒有購買紀錄的會員購買一次" />
        {f.kind === 'PERIOD' && <Active value={f.recurring} onChange={(v) => setF({ ...f, recurring: v })} label="開放定期定額：會員線上刷卡後每月自動扣款續約（需開放線上購買）" />}
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

function TypeForm({ t, onClose, onSaved }: { t: ClassType | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: t?.name ?? '', color: t?.color ?? COLORS[0], durationMin: String(t?.durationMin ?? 60), defaultCapacity: String(t?.defaultCapacity ?? 12),
    creditCost: String(t?.creditCost ?? 1), active: t?.active ?? true, isPrivate: t?.isPrivate ?? false, isOnline: t?.isOnline ?? false,
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, durationMin: +f.durationMin, defaultCapacity: +f.defaultCapacity, creditCost: +f.creditCost };
    if (t) await api.put(`/class-types/${t.id}`, body); else await api.post('/class-types', body);
    onSaved();
  }
  return (
    <Modal title={t ? '編輯課程類型' : '新增課程類型'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="名稱"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例如：哈達瑜珈" required /></Field>
        <Field label="顏色"><ColorPicker value={f.color} onChange={(c) => setF({ ...f, color: c })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="時長（分）"><input type="number" min={10} className="input" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
          <Field label="預設名額"><input type="number" min={1} className="input" value={f.defaultCapacity} onChange={(e) => setF({ ...f, defaultCapacity: e.target.value })} /></Field>
          <Field label="每堂扣"><input type="number" min={0} className="input" value={f.creditCost} onChange={(e) => setF({ ...f, creditCost: e.target.value })} /></Field>
        </div>
        <Active value={f.isPrivate} onChange={(v) => setF({ ...f, isPrivate: v })} label="私人課：會員依教練可預約時段自己預約（一堂一人）" />
        <Active value={f.isOnline} onChange={(v) => setF({ ...f, isOnline: v })} label="線上直播課（在課程或固定課表填入直播連結）" />
        <Active value={f.active} onChange={(v) => setF({ ...f, active: v })} label="開課中" />
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

function CoachForm({ c, onClose, onSaved }: { c: Coach | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: c?.name ?? '', phone: c?.phone ?? '', color: c?.color ?? COLORS[3], active: c?.active ?? true,
    payPerClass: String(c?.payPerClass ?? 0), payPerHead: String(c?.payPerHead ?? 0), headThreshold: String(c?.headThreshold ?? 0), revenueShare: String(c?.revenueShare ?? 0),
  });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tiers, setTiers] = useState<{ min: string; rate: string }[]>((c?.shareTiers ?? []).map((t) => ({ min: String(t.min), rate: String(t.rate) })));
  useEffect(() => { if (c) api.get(`/coaches/${c.id}/availability`).then((r) => setSlots(r.data)); }, [c]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const shareTiers = tiers.filter((t) => t.min !== '' && t.rate !== '').map((t) => ({ min: +t.min, rate: +t.rate }));
    const body = { ...f, phone: f.phone || null, payPerClass: +f.payPerClass || 0, payPerHead: +f.payPerHead || 0, headThreshold: +f.headThreshold || 0, revenueShare: +f.revenueShare || 0, shareTiers: shareTiers.length ? shareTiers : null };
    const saved = c ? (await api.put(`/coaches/${c.id}`, body)).data : (await api.post('/coaches', body)).data;
    await api.put(`/coaches/${saved.id}/availability`, { slots: slots.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })) });
    onSaved();
  }
  return (
    <Modal title={c ? '編輯教練' : '新增教練'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="姓名"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="電話"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="顏色"><ColorPicker value={f.color} onChange={(v) => setF({ ...f, color: v })} /></Field>
        <div className="border-t border-gray-100 pt-3">
          <div className="text-xs font-medium text-gray-500 mb-2">薪資計算（教練薪資報表使用）</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="每堂鐘點（元）"><input type="number" min={0} className="input" value={f.payPerClass} onChange={(e) => setF({ ...f, payPerClass: e.target.value })} /></Field>
            <Field label="課程產值抽成 %"><input type="number" min={0} max={100} className="input" value={f.revenueShare} onChange={(e) => setF({ ...f, revenueShare: e.target.value })} /></Field>
            <Field label="人數門檻"><input type="number" min={0} className="input" value={f.headThreshold} onChange={(e) => setF({ ...f, headThreshold: e.target.value })} /></Field>
            <Field label="超過門檻每人加給"><input type="number" min={0} className="input" value={f.payPerHead} onChange={(e) => setF({ ...f, payPerHead: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-gray-400 mt-1">例：每堂 800、超過 8 人每人加 50、不抽成。課程產值＝出席學員所用方案的每堂單價加總。</p>
          <div className="mt-3">
            <div className="text-xs font-medium text-gray-500">階梯式抽成（選填，設定後取代上面的固定 %）</div>
            <p className="text-xs text-gray-400">依當月總產值達到的最高門檻，整月套用該 %。例：0 起 10%、5 萬起 15%、10 萬起 20%。</p>
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 mt-1.5 text-sm">
                <input type="number" min={0} className="input w-32" value={t.min} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} placeholder="月產值門檻" aria-label="月產值門檻" />
                <span className="text-gray-400">元起</span>
                <input type="number" min={0} max={100} className="input w-20" value={t.rate} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} aria-label="抽成 %" />
                <span className="text-gray-400">%</span>
                <button type="button" className="text-xs text-gray-400 hover:text-red-500" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>移除</button>
              </div>
            ))}
            <button type="button" className="text-xs text-brand mt-1.5" onClick={() => setTiers([...tiers, { min: tiers.length ? '' : '0', rate: '' }])}>＋ 新增級距</button>
          </div>
        </div>
        <AvailabilityEditor slots={slots} onChange={setSlots} />
        <Active value={f.active} onChange={(v) => setF({ ...f, active: v })} label="在職" />
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

interface Slot { weekday: number; startTime: string; endTime: string }
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD = ['日', '一', '二', '三', '四', '五', '六'];

/** 教練每週可預約的私人課時段 */
function AvailabilityEditor({ slots, onChange }: { slots: Slot[]; onChange: (s: Slot[]) => void }) {
  const update = (i: number, patch: Partial<Slot>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">私人課可預約時段</span>
        <button type="button" className="text-xs text-brand" onClick={() => onChange([...slots, { weekday: 1, startTime: '10:00', endTime: '12:00' }])}>＋ 新增時段</button>
      </div>
      {slots.length === 0 ? <p className="text-xs text-gray-400">沒有設定時段，會員無法預約這位教練的私人課。</p> : (
        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="input w-24 text-sm" value={s.weekday} onChange={(e) => update(i, { weekday: +e.target.value })} aria-label="星期">
                {WD_ORDER.map((w) => <option key={w} value={w}>星期{WD[w]}</option>)}
              </select>
              <input type="time" className="input text-sm" value={s.startTime} onChange={(e) => update(i, { startTime: e.target.value })} aria-label="開始" />
              <span className="text-gray-400">～</span>
              <input type="time" className="input text-sm" value={s.endTime} onChange={(e) => update(i, { endTime: e.target.value })} aria-label="結束" />
              <button type="button" className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="移除時段" onClick={() => onChange(slots.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4 text-gray-400" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
