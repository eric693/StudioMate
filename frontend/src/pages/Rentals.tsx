import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Ban } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import Modal, { Field } from '../components/Modal';
import SearchBox, { matches } from '../components/SearchBox';
import { Branch, Member, Rental, Room } from '../types';
import { PAY_METHOD, addDays, dateTime, hm, localDay, money } from '../lib/format';
import Lockers from './Lockers';

export default function Rentals() {
  const [tab, setTab] = useState<'bookings' | 'rooms' | 'lockers'>('bookings');
  const [rooms, setRooms] = useState<Room[]>([]);
  const loadRooms = () => api.get('/rooms').then((r) => setRooms(r.data));
  useEffect(() => { loadRooms(); }, []);
  return (
    <div className="space-y-4">
      <div className="page-header"><div><h1 className="text-xl font-bold text-gray-800">場地與置物櫃</h1><p className="text-sm text-gray-400">教室空檔出租給外部老師或團體、會員置物櫃租用</p></div></div>
      <HowTo module="rentals" />
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['bookings', '租借紀錄'], ['rooms', `場地（${rooms.length}）`], ['lockers', '置物櫃']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'bookings' && <Bookings rooms={rooms} />}
      {tab === 'rooms' && <Rooms rooms={rooms} onChanged={loadRooms} />}
      {tab === 'lockers' && <Lockers />}
    </div>
  );
}

function Bookings({ rooms }: { rooms: Room[] }) {
  const [list, setList] = useState<Rental[]>([]);
  const [f, setF] = useState({ from: localDay(), to: addDays(localDay(), 30), q: '', roomId: '', status: 'BOOKED', paid: '' });
  const [editing, setEditing] = useState<Rental | 'new' | null>(null);
  const load = () => api.get('/rentals', { params: f }).then((r) => setList(r.data));
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  async function cancel(x: Rental) {
    if (!confirm(`取消 ${x.renterName} 的租借？`)) return;
    await api.put(`/rentals/${x.id}`, { status: 'CANCELLED' }); load();
  }
  async function remove(x: Rental) {
    if (!confirm(`刪除 ${x.renterName} 的租借紀錄？`)) return;
    await api.delete(`/rentals/${x.id}`); load();
  }
  const total = list.filter((x) => x.status === 'BOOKED').reduce((a, x) => a + x.price, 0);
  const unpaid = list.filter((x) => x.status === 'BOOKED' && !x.paid).reduce((a, x) => a + x.price, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder="搜尋租借人、電話、備註" />
        <span className="flex items-center gap-1 text-sm text-gray-400">
          <input type="date" className="input w-auto text-sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="開始日期" />～
          <input type="date" className="input w-auto text-sm" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="結束日期" />
        </span>
        <select className="input w-auto text-sm" value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })} aria-label="場地"><option value="">全部場地</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select className="input w-auto text-sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="狀態"><option value="">全部狀態</option><option value="BOOKED">已預約</option><option value="CANCELLED">已取消</option></select>
        <select className="input w-auto text-sm" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value })} aria-label="付款"><option value="">付款狀態</option><option value="yes">已付款</option><option value="no">未付款</option></select>
        <button className="btn-primary flex items-center gap-1 ml-auto" disabled={!rooms.length} onClick={() => setEditing('new')}><Plus className="w-4 h-4" />新增租借</button>
      </div>
      {!rooms.length && <div className="card text-sm text-gray-500">請先到「場地」分頁建立可出租的場地。</div>}
      <p className="text-xs text-gray-400">{list.length} 筆・租金合計 {money(total)}{unpaid ? `・未收 ${money(unpaid)}` : ''}</p>
      <div className="card p-0 overflow-hidden">
        {list.length === 0 ? <p className="text-sm text-gray-400 p-4">這段期間沒有符合條件的租借。</p> : (
          <div className="divide-y divide-gray-50">
            {list.map((x) => (
              <div key={x.id} className={`flex items-center gap-2 sm:gap-3 px-4 py-3 ${x.status === 'CANCELLED' ? 'opacity-50' : ''}`}>
                <div className="hidden sm:block w-28 flex-shrink-0 text-sm"><div className="text-gray-700">{dateTime(x.startsAt).split('）')[0]}）</div><div className="text-xs text-gray-400 font-mono">{hm(x.startsAt)}–{hm(x.endsAt)}</div></div>
                <div className="flex-1 min-w-0">
                  <div className="sm:hidden text-xs text-gray-500">{dateTime(x.startsAt).split('）')[0]}）{hm(x.startsAt)}–{hm(x.endsAt)}</div>
                  <div className="text-sm text-gray-800 truncate"><span className="font-medium">{x.renterName}</span><span className="text-gray-500 ml-2">{x.room.name}</span>
                    {x.status === 'CANCELLED' && <span className="text-[11px] text-gray-400 ml-2">已取消</span>}</div>
                  <div className="text-xs text-gray-400 truncate">{x.renterPhone}{x.note ? `・${x.note}` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-800">{money(x.price)}</div>
                  <div className={`text-[11px] ${x.paid ? 'text-green-600' : 'text-amber-600'}`}>{x.paid ? `已付・${PAY_METHOD[x.payMethod ?? 'OTHER']}` : '未付款'}</div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" onClick={() => setEditing(x)}><Pencil className="w-4 h-4 text-gray-400" /></button>
                {x.status === 'BOOKED' && <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="取消租借" title="取消租借" onClick={() => cancel(x)}><Ban className="w-4 h-4 text-gray-400" /></button>}
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" onClick={() => remove(x)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <RentalForm x={editing === 'new' ? null : editing} rooms={rooms} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function RentalForm({ x, rooms, onClose, onSaved }: { x: Rental | null; rooms: Room[]; onClose: () => void; onSaved: () => void }) {
  const active = rooms.filter((r) => r.active || r.id === x?.roomId);
  const [f, setF] = useState({
    roomId: x?.roomId ?? active[0]?.id ?? '', renterName: x?.renterName ?? '', renterPhone: x?.renterPhone ?? '', memberId: x?.memberId ?? '',
    date: x ? localDay(x.startsAt) : localDay(), startTime: x ? hm(x.startsAt) : '14:00', endTime: x ? hm(x.endsAt) : '16:00',
    price: x ? String(x.price) : '', paid: x?.paid ?? false, payMethod: x?.payMethod ?? 'CASH', note: x?.note ?? '', status: x?.status ?? 'BOOKED',
  });
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const t = setTimeout(() => api.get('/members', { params: { q } }).then((r) => setFound(r.data.slice(0, 5))), 250);
    return () => clearTimeout(t);
  }, [q]);
  const room = rooms.find((r) => r.id === f.roomId);
  const [sh, sm] = f.startTime.split(':').map(Number), [eh, em] = f.endTime.split(':').map(Number);
  const hours = Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, memberId: f.memberId || null, renterPhone: f.renterPhone || null, note: f.note || null, price: f.price === '' ? undefined : +f.price, payMethod: f.paid ? f.payMethod : null };
    if (x) await api.put(`/rentals/${x.id}`, body); else await api.post('/rentals', body);
    onSaved();
  }
  return (
    <Modal title={x ? '編輯租借' : '新增租借'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="場地"><select className="input" value={f.roomId} onChange={(e) => set('roomId', e.target.value)}>{active.map((r) => <option key={r.id} value={r.id}>{r.name}{r.branch ? `（${r.branch.name}）` : ''}・{money(r.hourlyRate)}/時</option>)}</select></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="日期"><input type="date" className="input" value={f.date} onChange={(e) => set('date', e.target.value)} required /></Field>
          <Field label="開始"><input type="time" className="input" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} required /></Field>
          <Field label="結束"><input type="time" className="input" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="租借人"><input className="input" value={f.renterName} onChange={(e) => set('renterName', e.target.value)} required /></Field>
          <Field label="電話"><input className="input" value={f.renterPhone} onChange={(e) => set('renterPhone', e.target.value)} /></Field>
        </div>
        <div className="relative">
          <Field label="從會員帶入（選填）"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋會員姓名或電話" /></Field>
          {found.length > 0 && (
            <div className="absolute z-10 left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
              {found.map((m) => <button type="button" key={m.id} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { setF((s) => ({ ...s, memberId: m.id, renterName: m.name, renterPhone: m.phone })); setQ(''); }}>{m.name} <span className="text-gray-400">{m.phone}</span></button>)}
            </div>
          )}
        </div>
        <Field label="租金" hint={room ? `空白＝依時租自動計算：${money(room.hourlyRate)} × ${hours} 小時 = ${money(Math.round(room.hourlyRate * hours))}` : undefined}>
          <input type="number" min={0} className="input" value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.paid} onChange={(e) => set('paid', e.target.checked)} />已付款</label>
          {f.paid && <select className="input w-auto text-sm" value={f.payMethod} onChange={(e) => set('payMethod', e.target.value)}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
        </div>
        {x && <Field label="狀態"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="BOOKED">已預約</option><option value="CANCELLED">已取消</option></select></Field>}
        <Field label="備註"><input className="input" value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="例如：外部瑜珈老師工作坊" /></Field>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

function Rooms({ rooms, onChanged }: { rooms: Room[]; onChanged: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Room | 'new' | null>(null);
  useEffect(() => { api.get('/branches').then((r) => setBranches(r.data)); }, []);
  const shown = rooms.filter((r) => matches(q, r.name, r.branch?.name, r.note) && (!active || (active === 'on') === r.active));
  async function remove(r: Room) {
    if (!confirm(`刪除場地「${r.name}」？`)) return;
    await api.delete(`/rooms/${r.id}`); onChanged();
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={q} onChange={setQ} placeholder="搜尋場地、分店" />
        <select className="input w-auto text-sm" value={active} onChange={(e) => setActive(e.target.value)} aria-label="狀態"><option value="">全部狀態</option><option value="on">開放出租</option><option value="off">停用</option></select>
        <button className="btn-primary flex items-center gap-1 ml-auto" onClick={() => setEditing('new')}><Plus className="w-4 h-4" />新增場地</button>
      </div>
      <p className="text-xs text-gray-400">場地名稱與課程的「教室」欄位相同時，系統會自動避開已排課的時段。</p>
      <div className="card p-0 overflow-hidden">
        {shown.length === 0 ? <p className="text-sm text-gray-400 p-4">{rooms.length ? '沒有符合條件的場地。' : '還沒有場地，例如「A 教室」「空中瑜珈教室」。'}</p> : (
          <div className="divide-y divide-gray-50">
            {shown.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${r.active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{r.name}{r.branch && <span className="text-xs text-gray-400 ml-2">{r.branch.name}</span>}{!r.active && <span className="text-xs text-gray-400 ml-2">停用</span>}</div>
                  <div className="text-xs text-gray-400">{money(r.hourlyRate)}/小時{r.capacity ? `・可容納 ${r.capacity} 人` : ''}{r.note ? `・${r.note}` : ''}</div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" onClick={() => setEditing(r)}><Pencil className="w-4 h-4 text-gray-400" /></button>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" onClick={() => remove(r)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <RoomForm r={editing === 'new' ? null : editing} branches={branches} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </div>
  );
}

function RoomForm({ r, branches, onClose, onSaved }: { r: Room | null; branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: r?.name ?? '', branchId: r?.branchId ?? '', hourlyRate: String(r?.hourlyRate ?? 500), capacity: r?.capacity ? String(r.capacity) : '', active: r?.active ?? true, note: r?.note ?? '' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, branchId: f.branchId || null, hourlyRate: +f.hourlyRate || 0, capacity: f.capacity ? +f.capacity : null, note: f.note || null };
    if (r) await api.put(`/rooms/${r.id}`, body); else await api.post('/rooms', body);
    onSaved();
  }
  return (
    <Modal title={r ? '編輯場地' : '新增場地'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="名稱" hint="與課程的「教室」名稱一致，才能自動避開已排課的時段"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        {branches.length > 0 && <Field label="分店"><select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">不指定</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="時租（元）"><input type="number" min={0} className="input" value={f.hourlyRate} onChange={(e) => setF({ ...f, hourlyRate: e.target.value })} /></Field>
          <Field label="可容納人數"><input type="number" min={1} className="input" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />開放出租</label>
        <Field label="備註"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="例如：含音響、瑜珈墊 15 張" /></Field>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}
