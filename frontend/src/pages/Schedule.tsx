import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Check, UserX, Undo2, XCircle, Search, Pencil, Trash2, QrCode, UserRound, Video } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import SearchBox, { matches } from '../components/SearchBox';
import Modal, { Field } from '../components/Modal';
import { Branch, ClassType, Coach, Member, RosterBooking, Session } from '../types';
import { addDays, BOOKING_STATUS, dateTime, hm, localDay, passText, shortDay, weekStart, WEEKDAYS } from '../lib/format';

type Editing = { session?: SessionDetail } | null;

export default function Schedule() {
  const [params, setParams] = useSearchParams();
  const [start, setStart] = useState(() => weekStart(localDay()));
  const [sessions, setSessions] = useState<Session[]>([]);
  const [openId, setOpenId] = useState<string | null>(params.get('session'));
  const [editing, setEditing] = useState<Editing>(null);
  const [mobileDay, setMobileDay] = useState(() => localDay());
  const [types, setTypes] = useState<ClassType[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [q, setQ] = useState('');
  const [typeId, setTypeId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [status, setStatus] = useState<'' | 'OPEN' | 'FULL' | 'CANCELLED'>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [privateOpen, setPrivateOpen] = useState(false);
  useEffect(() => {
    api.get('/class-types').then((r) => setTypes(r.data));
    api.get('/coaches').then((r) => setCoaches(r.data));
    api.get('/branches').then((r) => setBranches(r.data.filter((b: Branch) => b.active)));
  }, []);

  const load = useCallback(() => {
    api.get('/sessions', { params: { from: start, to: addDays(start, 6) } }).then((r) => setSessions(r.data));
  }, [start]);
  useEffect(load, [load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const shown = sessions.filter((s) =>
    matches(q, s.classType.name, s.coach?.name, s.room, s.note)
    && (!typeId || s.classType.id === typeId)
    && (!coachId || s.coach?.id === coachId)
    && (!branchId || s.branch?.id === branchId)
    && (!status || (status === 'CANCELLED' ? s.status === 'CANCELLED'
      : s.status === 'SCHEDULED' && (status === 'FULL' ? s.booked >= s.capacity : s.booked < s.capacity))));
  const filtered = shown.length !== sessions.length;
  const byDay = (d: string) => shown.filter((s) => localDay(s.startsAt) === d);
  const today = localDay();

  function open(id: string | null) {
    setOpenId(id);
    if (!id && params.get('session')) { params.delete('session'); setParams(params, { replace: true }); }
  }
  function shiftWeek(n: number) {
    const ns = addDays(start, n * 7);
    setStart(ns);
    setMobileDay(ns);
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-800">課表與點名</h1>
          <p className="text-sm text-gray-400">{shortDay(days[0])} – {shortDay(days[6])}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary px-2" onClick={() => shiftWeek(-1)} aria-label="上一週"><ChevronLeft className="w-4 h-4" /></button>
          <button className="btn-secondary" onClick={() => { setStart(weekStart(today)); setMobileDay(today); }}>本週</button>
          <button className="btn-secondary px-2" onClick={() => shiftWeek(1)} aria-label="下一週"><ChevronRight className="w-4 h-4" /></button>
          <Link to="/checkin-display" className="btn-secondary px-2 flex items-center" title="簽到 QR code" aria-label="簽到 QR code"><QrCode className="w-4 h-4" /></Link>
          {types.some((t) => t.isPrivate && t.active) && <button className="btn-secondary flex items-center gap-1" onClick={() => setPrivateOpen(true)}><UserRound className="w-4 h-4" /><span className="hidden sm:inline">私人課</span></button>}
          <button className="btn-primary flex items-center gap-1" onClick={() => setEditing({})}><Plus className="w-4 h-4" /><span className="hidden sm:inline">加開一堂課</span><span className="sm:hidden">加開</span></button>
        </div>
      </div>
      <HowTo module="schedule" />
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={q} onChange={setQ} placeholder="搜尋課程、教練、教室、備註" />
        <select className="input w-auto text-sm" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="課程類型">
          <option value="">全部課程</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input w-auto text-sm" value={coachId} onChange={(e) => setCoachId(e.target.value)} aria-label="教練">
          <option value="">全部教練</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {branches.length > 0 && <select className="input w-auto text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="分店">
          <option value="">全部分店</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
        <select className="input w-auto text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="狀態">
          <option value="">全部狀態</option><option value="OPEN">還有名額</option><option value="FULL">額滿</option><option value="CANCELLED">已取消</option>
        </select>
        {filtered && <span className="text-xs text-gray-400">本週符合 {shown.length} / {sessions.length} 堂
          <button className="ml-2 text-brand hover:underline" onClick={() => { setQ(''); setTypeId(''); setCoachId(''); setStatus(''); setBranchId(''); }}>清除篩選</button></span>}
      </div>

      {/* 手機：一次看一天 */}
      <div className="md:hidden">
        <div className="flex gap-1 overflow-x-auto pb-2">
          {days.map((d) => (
            <button key={d} onClick={() => setMobileDay(d)}
              className={`flex-shrink-0 w-12 py-1.5 rounded-xl text-center text-xs ${mobileDay === d ? 'bg-brand text-white' : d === today ? 'bg-brand/10 text-brand' : 'bg-white text-gray-600'}`}>
              <div>{WEEKDAYS[(days.indexOf(d) + 1) % 7]}</div><div className="font-semibold">{+d.slice(8)}</div>
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {byDay(mobileDay).length === 0 && <p className="text-sm text-gray-400 py-6 text-center">{filtered ? '這天沒有符合篩選的課程' : '這天沒有課程'}</p>}
          {byDay(mobileDay).map((s) => <SessionCard key={s.id} s={s} onClick={() => open(s.id)} />)}
        </div>
      </div>

      {/* 桌機：一週七欄 */}
      <div className="hidden md:grid grid-cols-7 gap-2">
        {days.map((d, i) => (
          <div key={d} className="min-w-0">
            <div className={`text-center text-xs font-medium mb-2 py-1 rounded-lg ${d === today ? 'bg-brand text-white' : 'text-gray-500'}`}>
              週{WEEKDAYS[(i + 1) % 7]} {+d.slice(5, 7)}/{+d.slice(8)}
            </div>
            <div className="space-y-1.5">
              {byDay(d).map((s) => <SessionCard key={s.id} s={s} onClick={() => open(s.id)} compact />)}
            </div>
          </div>
        ))}
      </div>

      {openId && <SessionPanel id={openId} onClose={() => open(null)} onChanged={load} onEdit={(session) => setEditing({ session })} />}
      {privateOpen && <PrivateBook types={types.filter((t) => t.isPrivate && t.active)} coaches={coaches.filter((c) => c.active)} onClose={() => setPrivateOpen(false)} onDone={() => { setPrivateOpen(false); load(); }} />}
      {editing && <SessionForm session={editing.session} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); if (editing.session) { setOpenId(null); setTimeout(() => setOpenId(editing.session!.id)); } }} />}
    </div>
  );
}

function SessionCard({ s, onClick, compact }: { s: Session; onClick: () => void; compact?: boolean }) {
  const cancelled = s.status === 'CANCELLED';
  const full = s.booked >= s.capacity;
  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-xl bg-white border-l-4 shadow-sm hover:shadow transition-shadow ${compact ? 'p-2' : 'p-3'} ${cancelled ? 'opacity-50' : ''}`}
      style={{ borderLeftColor: cancelled ? '#d1d5db' : s.classType.color }}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-mono text-gray-500">{hm(s.startsAt)}</span>
        {cancelled ? <span className="text-[10px] text-gray-400">已取消</span>
          : <span className={`text-xs font-semibold ${full ? 'text-brand' : 'text-gray-600'}`}>{s.booked}/{s.capacity}</span>}
      </div>
      <div className={`text-sm font-medium truncate ${cancelled ? 'line-through text-gray-400' : 'text-gray-800'}`}>{s.classType.name}</div>
      <div className="text-xs text-gray-400 truncate flex items-center gap-1">
        {s.isPrivate && <UserRound className="w-3 h-3 text-purple-500 flex-shrink-0" aria-label="私人課" />}
        {s.liveUrl && <Video className="w-3 h-3 text-sky-500 flex-shrink-0" aria-label="直播" />}
        <span className="truncate">{s.coach?.name ?? '未指定'}{s.branch ? `・${s.branch.name}` : ''}{s.waitlist ? `・候補 ${s.waitlist}` : ''}</span>
      </div>
    </button>
  );
}

interface SessionDetail extends Omit<Session, 'booked' | 'waitlist' | 'attended'> { bookings: RosterBooking[] }

function SessionPanel({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (s: SessionDetail) => void }) {
  const [s, setS] = useState<SessionDetail | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [msg, setMsg] = useState('');
  const [capacity, setCapacity] = useState<number | ''>('');
  const [forceRefund, setForceRefund] = useState(false);

  const load = useCallback(() => api.get(`/sessions/${id}`).then((r) => { setS(r.data); setCapacity(r.data.capacity); }), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api.get('/members', { params: { q, status: 'ACTIVE' } }).then((r) => setResults(r.data.slice(0, 6))), 250);
    return () => clearTimeout(t);
  }, [q]);

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setMsg('');
    try { await fn(); setMsg(okMsg); await load(); onChanged(); } catch { /* 錯誤訊息由 API client 顯示 */ }
  }
  if (!s) return <Modal title="載入中…" onClose={onClose}><div className="text-sm text-gray-400">載入中…</div></Modal>;

  const active = s.bookings.filter((b) => ['BOOKED', 'ATTENDED', 'NO_SHOW'].includes(b.status));
  const waitlist = s.bookings.filter((b) => b.status === 'WAITLIST');
  const others = s.bookings.filter((b) => ['CANCELLED', 'LATE_CANCELLED'].includes(b.status));
  const seated = s.bookings.filter((b) => ['BOOKED', 'ATTENDED'].includes(b.status)).length;
  const cancelled = s.status === 'CANCELLED';
  const ended = new Date(s.endsAt) < new Date();

  return (
    <Modal title={`${s.classType.name}・${dateTime(s.startsAt)}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>教練：{s.coach?.name ?? '未指定'}</span>
          {s.room && <span>教室：{s.room}</span>}
          <span>正取 {seated}/{s.capacity}{waitlist.length ? `・候補 ${waitlist.length}` : ''}</span>
          {s.classType.creditCost !== 1 && <span>每堂扣 {s.classType.creditCost} 堂</span>}
          {s.branch && <span>分店：{s.branch.name}</span>}
          {s.liveUrl && <a href={s.liveUrl} target="_blank" rel="noreferrer" className="text-sky-600 underline">直播連結</a>}
          {s.note && <span>備註：{s.note}</span>}
          {!cancelled && (
            <span className="ml-auto flex gap-1">
              <button className="btn-secondary text-xs py-1 flex items-center gap-1" onClick={() => onEdit(s)}><Pencil className="w-3.5 h-3.5" />編輯</button>
              {s.bookings.length === 0 && <button className="btn-secondary text-xs py-1 flex items-center gap-1" onClick={async () => {
                if (!confirm('刪除這堂課？（沒有任何預約紀錄才能刪除）')) return;
                await api.delete(`/sessions/${s.id}`); onChanged(); onClose();
              }}><Trash2 className="w-3.5 h-3.5" />刪除</button>}
            </span>
          )}
        </div>
        {cancelled && <div className="text-sm bg-gray-50 text-gray-500 rounded-xl p-3">這堂課已取消{s.cancelReason ? `：${s.cancelReason}` : ''}</div>}
        {msg && <div className="text-sm bg-green-50 text-green-700 rounded-xl px-3 py-2">{msg}</div>}

        {!cancelled && !ended && (
          <div className="relative">
            <div className="flex items-center gap-2 input">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input className="flex-1 outline-none bg-transparent text-sm" placeholder="搜尋會員姓名或電話，加入預約" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {results.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
                {results.map((m) => (
                  <button key={m.id} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm flex justify-between gap-2"
                    onClick={() => { setQ(''); act(() => api.post('/bookings', { sessionId: s.id, memberId: m.id }), `已幫 ${m.name} 預約`); }}>
                    <span className="font-medium">{m.name} <span className="text-gray-400 font-normal">{m.phone}</span></span>
                    <span className="text-xs text-gray-400 truncate">{m.activePasses?.length ? passText(m.activePasses[0]) : '沒有有效方案'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <Roster title={`名單（${active.length}）`} rows={active} empty="還沒有人預約" render={(b) => (
          <div className="flex gap-1 flex-shrink-0">
            {b.status === 'BOOKED' && <>
              <IconBtn title="出席" onClick={() => act(() => api.post(`/bookings/${b.id}/attendance`, { action: 'attend' }), `${b.member.name} 已點名`)}><Check className="w-4 h-4 text-green-600" /></IconBtn>
              {ended ? <IconBtn title="未到" onClick={() => act(() => api.post(`/bookings/${b.id}/attendance`, { action: 'noshow' }), `${b.member.name} 標為未到`)}><UserX className="w-4 h-4 text-red-500" /></IconBtn>
                : <IconBtn title="取消預約" onClick={() => act(() => api.post(`/bookings/${b.id}/cancel`, { forceRefund }), `已取消 ${b.member.name} 的預約`)}><XCircle className="w-4 h-4 text-gray-400" /></IconBtn>}
            </>}
            {['ATTENDED', 'NO_SHOW'].includes(b.status) && <IconBtn title="復原" onClick={() => act(() => api.post(`/bookings/${b.id}/attendance`, { action: 'undo' }), '已復原')}><Undo2 className="w-4 h-4 text-gray-400" /></IconBtn>}
          </div>
        )} />
        {waitlist.length > 0 && <Roster title={`候補（${waitlist.length}）`} rows={waitlist} empty="" render={(b) => (
          <IconBtn title="取消候補" onClick={() => act(() => api.post(`/bookings/${b.id}/cancel`, {}), `已取消 ${b.member.name} 的候補`)}><XCircle className="w-4 h-4 text-gray-400" /></IconBtn>
        )} />}
        {others.length > 0 && <Roster title="已取消" rows={others} empty="" muted />}

        {!cancelled && !ended && (
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={forceRefund} onChange={(e) => setForceRefund(e.target.checked)} />
              取消預約時例外退堂（超過取消截止時間也退回堂數，例如會員生病）
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="名額">
                <input type="number" min={1} className="input w-24" value={capacity} onChange={(e) => setCapacity(e.target.value === '' ? '' : +e.target.value)} />
              </Field>
              <button className="btn-secondary" disabled={capacity === '' || capacity === s.capacity}
                onClick={() => act(() => api.put(`/sessions/${s.id}`, { capacity }), '已更新名額（候補會自動遞補）')}>更新名額</button>
              <button className="btn-danger ml-auto" onClick={() => {
                const reason = window.prompt('取消這堂課？所有預約會退回堂數，並通知已綁定 LINE 的會員。\n\n取消原因（選填）：');
                if (reason !== null) act(() => api.post(`/sessions/${s.id}/cancel`, { reason }), '已取消這堂課');
              }}>取消整堂課</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Roster({ title, rows, empty, render, muted }: { title: string; rows: RosterBooking[]; empty: string; render?: (b: RosterBooking) => React.ReactNode; muted?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 mb-1.5">{title}</div>
      {rows.length === 0 ? <p className="text-sm text-gray-400">{empty}</p> : (
        <div className={`divide-y divide-gray-50 ${muted ? 'opacity-60' : ''}`}>
          {rows.map((b) => (
            <div key={b.id} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">
                  {b.member.name}
                  <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full ${BOOKING_STATUS[b.status].cls}`}>{BOOKING_STATUS[b.status].label}</span>
                  {b.promotedAt && <span className="ml-1 text-[11px] text-amber-600">候補遞補</span>}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {b.member.phone}{b.membership ? `・${b.membership.planName}${b.membership.kind !== 'PERIOD' ? `（剩 ${b.membership.creditsLeft}）` : ''}` : ''}{b.source === 'MEMBER' ? '・會員自行預約' : ''}
                </div>
              </div>
              {render?.(b)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const IconBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button title={title} aria-label={title} onClick={onClick} className="p-2 rounded-lg border border-gray-100 hover:bg-gray-50">{children}</button>
);

function SessionForm({ session, onClose, onSaved }: { session?: SessionDetail; onClose: () => void; onSaved: () => void }) {
  const [types, setTypes] = useState<ClassType[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const booked = session?.bookings.some((b) => !['CANCELLED', 'LATE_CANCELLED'].includes(b.status)) ?? false;
  const [f, setF] = useState(() => ({
    classTypeId: session?.classType.id ?? '', coachId: session?.coach?.id ?? '',
    date: session ? localDay(session.startsAt) : localDay(), startTime: session ? hm(session.startsAt) : '19:00',
    durationMin: session ? String(Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60e3)) : '',
    capacity: session ? String(session.capacity) : '', room: session?.room ?? '', note: session?.note ?? '',
    branchId: session?.branch?.id ?? '', liveUrl: session?.liveUrl ?? '',
  }));
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    api.get('/class-types').then((r) => { const a = r.data.filter((t: ClassType) => t.active || t.id === session?.classType.id); setTypes(a); if (!session && a[0]) setF((x) => ({ ...x, classTypeId: a[0].id })); });
    api.get('/coaches').then((r) => setCoaches(r.data.filter((c: Coach) => c.active || c.id === session?.coach?.id)));
    api.get('/branches').then((r) => setBranches(r.data.filter((b: Branch) => b.active || b.id === session?.branch?.id)));
  }, [session]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const ct = types.find((t) => t.id === f.classTypeId);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      classTypeId: f.classTypeId, coachId: f.coachId || null, room: f.room || null, note: f.note || null,
      branchId: f.branchId || null, liveUrl: f.liveUrl || null,
      capacity: f.capacity ? +f.capacity : undefined, durationMin: f.durationMin ? +f.durationMin : undefined,
      ...(booked ? {} : { date: f.date, startTime: f.startTime }),
    };
    if (session) await api.put(`/sessions/${session.id}`, body); else await api.post('/sessions', body);
    onSaved();
  }
  return (
    <Modal title={session ? '編輯課程' : '加開一堂課'} onClose={onClose}>
      {types.length === 0 ? <p className="text-sm text-gray-500">請先到「方案與課程」建立課程類型。</p> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="課程類型"><select className="input" value={f.classTypeId} onChange={(e) => set('classTypeId', e.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="教練"><select className="input" value={f.coachId} onChange={(e) => set('coachId', e.target.value)}><option value="">未指定</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="日期"><input type="date" className="input" value={f.date} onChange={(e) => set('date', e.target.value)} required disabled={booked} /></Field>
            <Field label="開始時間"><input type="time" className="input" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} required disabled={booked} /></Field>
            <Field label="時長（分）"><input type="number" min={10} className="input" value={f.durationMin} placeholder={String(ct?.durationMin ?? 60)} onChange={(e) => set('durationMin', e.target.value)} disabled={booked} /></Field>
          </div>
          {booked && <p className="text-xs text-amber-600 -mt-1">已經有人預約，日期與時間不能修改；如需改期請取消整堂課後重新加開。</p>}
          {session?.templateId && !booked && <p className="text-xs text-gray-400 -mt-1">修改時間後，這堂課會脫離固定課表，成為單獨的一堂課。</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="名額" hint={session ? '加大名額會自動遞補候補' : '空白＝用課程類型的預設值'}><input type="number" min={1} className="input" value={f.capacity} placeholder={String(ct?.defaultCapacity ?? '')} onChange={(e) => set('capacity', e.target.value)} /></Field>
            <Field label="教室"><input className="input" value={f.room} onChange={(e) => set('room', e.target.value)} placeholder="例如 A 教室" /></Field>
          </div>
          {branches.length > 0 && <Field label="分店"><select className="input" value={f.branchId} onChange={(e) => set('branchId', e.target.value)}><option value="">不指定</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          {(ct?.isOnline || f.liveUrl) && <Field label="直播連結" hint="只有已預約的會員，在開課前 15 分鐘起看得到"><input className="input" type="url" value={f.liveUrl} onChange={(e) => set('liveUrl', e.target.value)} placeholder="https://meet.google.com/..." /></Field>}
          <Field label="備註"><input className="input" value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="例如：工作坊、限定進階學員" /></Field>
          <button className="btn-primary w-full">{session ? '儲存' : '建立'}</button>
        </form>
      )}
    </Modal>
  );
}

/** 櫃檯幫會員預約私人課：選會員、課程、教練、日期，從空檔中挑時間 */
function PrivateBook({ types, coaches, onClose, onDone }: { types: ClassType[]; coaches: Coach[]; onClose: () => void; onDone: () => void }) {
  const [member, setMember] = useState<Member | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member[]>([]);
  const [f, setF] = useState({ classTypeId: types[0]?.id ?? '', coachId: '', date: localDay() });
  const [slots, setSlots] = useState<string[] | null>(null);
  const [withSlots, setWithSlots] = useState<Coach[]>([]);
  useEffect(() => { api.get('/private/options').then((r) => { setWithSlots(r.data.coaches); if (r.data.coaches[0]) setF((x) => ({ ...x, coachId: x.coachId || r.data.coaches[0].id })); }); }, []);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const t = setTimeout(() => api.get('/members', { params: { q, status: 'ACTIVE' } }).then((r) => setFound(r.data.slice(0, 6))), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!f.coachId || !f.classTypeId) return;
    setSlots(null);
    api.get('/private/slots', { params: f }).then((r) => setSlots(r.data));
  }, [f]);
  async function book(time: string) {
    if (!member) return;
    if (!confirm(`幫 ${member.name} 預約 ${f.date} ${time} 的私人課？`)) return;
    await api.post('/private/book', { ...f, memberId: member.id, startTime: time });
    onDone();
  }
  const usable = coaches.filter((c) => withSlots.some((w) => w.id === c.id));
  return (
    <Modal title="預約私人課" onClose={onClose}>
      <div className="space-y-3">
        {member ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 text-sm">
            <span><span className="font-medium">{member.name}</span> <span className="text-gray-400">{member.phone}</span></span>
            <button className="text-xs text-brand" onClick={() => setMember(null)}>更換</button>
          </div>
        ) : (
          <div>
            <Field label="會員"><input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名或電話" /></Field>
            <div className="divide-y divide-gray-50">{found.map((m) => (
              <button key={m.id} className="w-full text-left px-1 py-2 text-sm hover:bg-gray-50 flex justify-between" onClick={() => setMember(m)}>
                <span>{m.name} <span className="text-gray-400">{m.phone}</span></span><span className="text-xs text-gray-400">{m.activePasses?.length ? passText(m.activePasses[0]) : '沒有有效方案'}</span>
              </button>))}</div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="課程"><select className="input" value={f.classTypeId} onChange={(e) => setF({ ...f, classTypeId: e.target.value })}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}（{t.durationMin} 分）</option>)}</select></Field>
          <Field label="教練"><select className="input" value={f.coachId} onChange={(e) => setF({ ...f, coachId: e.target.value })}>{usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        {!usable.length && <p className="text-xs text-amber-600">還沒有教練設定私人課時段，請到「方案與課程 → 教練」設定。</p>}
        <Field label="日期"><input type="date" className="input" value={f.date} min={localDay()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1.5">可預約時間</div>
          {!slots ? <p className="text-sm text-gray-400">載入中…</p> : slots.length === 0 ? <p className="text-sm text-gray-400">這天沒有空檔。</p> : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((t) => <button key={t} disabled={!member} className="btn-secondary text-sm py-1.5 disabled:opacity-40" onClick={() => book(t)}>{t}</button>)}
            </div>
          )}
          {!member && slots?.length ? <p className="text-xs text-gray-400 mt-1">先選擇會員再點時間</p> : null}
        </div>
      </div>
    </Modal>
  );
}
