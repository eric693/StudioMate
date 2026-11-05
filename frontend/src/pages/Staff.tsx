import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Trash2, Check, X } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import Modal, { Field } from '../components/Modal';
import { Tabs } from '../components/MemberPicker';
import { Coach } from '../types';
import { addDays, dateTime, hm, hours, localDay, shortDay, weekStart } from '../lib/format';

interface Shift { id: string; staffId: string; date: string; startTime: string; endTime: string; note: string | null; staff: { id: string; name: string } }
interface StaffUser { id: string; name: string; role: string }
interface Leave {
  id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string | null; reviewNote: string | null; createdAt: string;
  coach: { id: string; name: string }; substitute: { id: string; name: string } | null;
  session: { id: string; startsAt: string; classType: { name: string; color: string }; _count: { bookings: number } };
}

export default function Staff() {
  const [tab, setTab] = useState<'shifts' | 'attendance' | 'leaves'>('shifts');
  return (
    <div className="space-y-4">
      <div className="page-header"><div><h1 className="text-xl font-bold text-gray-800">員工與教練</h1><p className="text-sm text-gray-400">排班、出勤工時、教練請假與代課</p></div></div>
      <HowTo module="staff" />
      <Tabs tabs={[['shifts', '班表'], ['attendance', '出勤'], ['leaves', '請假審核']]} value={tab} onChange={setTab} />
      {tab === 'shifts' && <Shifts />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'leaves' && <Leaves />}
    </div>
  );
}

function Shifts() {
  const [from, setFrom] = useState(weekStart(localDay()));
  const [data, setData] = useState<{ shifts: Shift[]; staff: StaffUser[] } | null>(null);
  const [edit, setEdit] = useState<{ staffId: string; date: string; shift?: Shift } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const load = () => api.get('/shifts', { params: { from, to: addDays(from, 6) } }).then((r) => setData(r.data));
  useEffect(() => { load(); }, [from]); // eslint-disable-line react-hooks/exhaustive-deps
  async function copyWeek() {
    const r = await api.post('/shifts/copy-week', { from });
    alert(r.data.created ? `已從上週複製 ${r.data.created} 個班次` : '上週沒有可複製的班次（或本週已存在）');
    load();
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button className="p-2 rounded-lg hover:bg-white" onClick={() => setFrom(addDays(from, -7))} aria-label="上一週"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-sm font-medium text-gray-700">{shortDay(from)} ~ {shortDay(addDays(from, 6))}</span>
        <button className="p-2 rounded-lg hover:bg-white" onClick={() => setFrom(addDays(from, 7))} aria-label="下一週"><ChevronRight className="w-4 h-4" /></button>
        <button className="btn-secondary text-sm ml-auto flex items-center gap-1" onClick={copyWeek}><Copy className="w-4 h-4" />複製上週班表</button>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[48rem] table-fixed">
          <thead><tr className="border-b border-gray-100"><th className="w-28 px-3 py-2 text-left text-xs text-gray-400 font-normal">員工</th>{days.map((d) => <th key={d} className={`py-2 text-xs font-normal ${d === localDay() ? 'text-brand' : 'text-gray-400'}`}>{shortDay(d)}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">
            {data?.staff.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2 text-gray-700 truncate">{u.name}</td>
                {days.map((d) => {
                  const mine = data.shifts.filter((s) => s.staffId === u.id && s.date.slice(0, 10) === d);
                  return (
                    <td key={d} className="p-1 align-top">
                      <div className="space-y-1">
                        {mine.map((s) => <button key={s.id} onClick={() => setEdit({ staffId: u.id, date: d, shift: s })} className="w-full text-xs bg-brand/10 text-brand rounded-lg px-1.5 py-1 text-left">{s.startTime}–{s.endTime}{s.note ? <div className="text-[10px] text-gray-500 truncate">{s.note}</div> : null}</button>)}
                        <button onClick={() => setEdit({ staffId: u.id, date: d })} className="w-full text-xs text-gray-300 hover:text-brand rounded-lg py-1" aria-label={`新增 ${u.name} ${d} 班次`}>＋</button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <ShiftForm {...edit} staff={data?.staff ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function ShiftForm({ staffId, date, shift, staff, onClose, onSaved }: { staffId: string; date: string; shift?: Shift; staff: StaffUser[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ staffId, date, startTime: shift?.startTime ?? '09:00', endTime: shift?.endTime ?? '18:00', note: shift?.note ?? '' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, note: f.note || null };
    if (shift) await api.put(`/shifts/${shift.id}`, body); else await api.post('/shifts', body);
    onSaved();
  }
  async function remove() { await api.delete(`/shifts/${shift!.id}`); onSaved(); }
  return (
    <Modal title={shift ? '編輯班次' : '新增班次'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="員工"><select className="input" value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="日期"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="上班"><input type="time" className="input" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
          <Field label="下班"><input type="time" className="input" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        </div>
        <Field label="備註"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="櫃檯、清潔、教學" /></Field>
        <button className="btn-primary w-full">儲存</button>
        {shift && <button type="button" className="btn-danger w-full" onClick={remove}>刪除班次</button>}
      </form>
    </Modal>
  );
}

interface ClockRow { staffId: string; name: string; days: number; workedHours: number; scheduledHours: number; open: number; clocks: { id: string; clockIn: string; clockOut: string | null; note: string | null }[] }

function Attendance() {
  const [month, setMonth] = useState(localDay().slice(0, 7));
  const [rows, setRows] = useState<ClockRow[] | null>(null);
  const [fix, setFix] = useState<{ staffId: string; clock?: ClockRow['clocks'][number] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api.get('/clocks/report', { params: { month } }).then((r) => setRows(r.data.rows));
  useEffect(() => { load(); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps
  async function remove(id: string) { if (!confirm('刪除這筆打卡？')) return; await api.delete(`/clocks/${id}`); load(); }
  return (
    <div className="space-y-3">
      <input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="月份" />
      <div className="card p-0 overflow-hidden divide-y divide-gray-50">
        {rows?.map((r) => (
          <div key={r.staffId}>
            <button className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-left hover:bg-gray-50" onClick={() => setOpen(open === r.staffId ? null : r.staffId)}>
              <span className="font-medium text-gray-800 w-24">{r.name}</span>
              <span className="text-gray-500">出勤 {r.days} 天</span>
              <span className="text-gray-700">實際 {hours(r.workedHours)}</span>
              <span className="text-gray-400">排班 {hours(r.scheduledHours)}</span>
              {r.open > 0 && <span className="text-xs bg-amber-50 text-amber-700 px-2 rounded-full">{r.open} 筆未打下班卡</span>}
            </button>
            {open === r.staffId && (
              <div className="px-4 pb-3 space-y-1">
                {r.clocks.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="w-28">{dateTime(c.clockIn)}</span><span>~ {c.clockOut ? hm(c.clockOut) : <span className="text-amber-600">未下班</span>}</span>
                    {c.clockOut && <span className="text-gray-400">{hours((new Date(c.clockOut).getTime() - new Date(c.clockIn).getTime()) / 3600e3)}</span>}
                    <button className="text-brand ml-auto" onClick={() => setFix({ staffId: r.staffId, clock: c })}>修正</button>
                    <button onClick={() => remove(c.id)} aria-label="刪除"><Trash2 className="w-3.5 h-3.5 text-gray-300" /></button>
                  </div>
                ))}
                <button className="text-xs text-brand" onClick={() => setFix({ staffId: r.staffId })}>＋ 補登打卡</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {fix && <ClockForm {...fix} onClose={() => setFix(null)} onSaved={() => { setFix(null); load(); }} />}
    </div>
  );
}

function ClockForm({ staffId, clock, onClose, onSaved }: { staffId: string; clock?: { id: string; clockIn: string; clockOut: string | null; note: string | null }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ date: clock ? localDay(clock.clockIn) : localDay(), inTime: clock ? hm(clock.clockIn) : '09:00', outTime: clock?.clockOut ? hm(clock.clockOut) : '', note: clock?.note ?? '' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { staffId, date: f.date, inTime: f.inTime, outTime: f.outTime || null, note: f.note || null };
    if (clock) await api.put(`/clocks/${clock.id}`, body); else await api.post('/clocks', body);
    onSaved();
  }
  return (
    <Modal title={clock ? '修正打卡' : '補登打卡'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="日期"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="上班"><input type="time" className="input" value={f.inTime} onChange={(e) => setF({ ...f, inTime: e.target.value })} required /></Field>
          <Field label="下班" hint="早於上班時間視為隔天"><input type="time" className="input" value={f.outTime} onChange={(e) => setF({ ...f, outTime: e.target.value })} /></Field>
        </div>
        <Field label="備註"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="例如：忘記打卡" /></Field>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

function Leaves() {
  const [status, setStatus] = useState('PENDING');
  const [list, setList] = useState<Leave[] | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const load = () => api.get('/leaves', { params: { status: status || undefined } }).then((r) => setList(r.data));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/coaches').then((r) => setCoaches(r.data.filter((c: Coach) => c.active))); }, []);
  async function review(l: Leave, action: 'approve' | 'reject') {
    const substituteId = pick[l.id] || l.substitute?.id;
    if (action === 'approve' && !substituteId) { alert('請先選擇代課教練'); return; }
    await api.post(`/leaves/${l.id}/review`, { action, substituteId });
    load();
  }
  const STATUS = { PENDING: '待審核', APPROVED: '已核准', REJECTED: '已退回' };
  return (
    <div className="space-y-3">
      <select className="input w-auto text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="狀態">
        <option value="">全部</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <p className="text-xs text-gray-400">教練可以在「課表與點名」點開自己的課提出請假。核准時選代課教練，系統會換教練並用 LINE 通知已預約的會員。</p>
      <div className="card p-0 overflow-hidden divide-y divide-gray-50">
        {list?.length === 0 && <p className="text-sm text-gray-400 p-4">沒有請假申請。</p>}
        {list?.map((l) => (
          <div key={l.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="w-1.5 h-8 rounded-full" style={{ background: l.session.classType.color }} />
            <div className="flex-1 min-w-[12rem]">
              <div className="text-gray-800">{dateTime(l.session.startsAt)} {l.session.classType.name}<span className="text-gray-400 ml-2">{l.session._count.bookings} 人已預約</span></div>
              <div className="text-xs text-gray-500">{l.coach.name} 請假{l.reason ? `：${l.reason}` : ''}{l.substitute ? `・代課 ${l.substitute.name}` : ''}<span className="ml-2 text-gray-400">{STATUS[l.status]}</span></div>
            </div>
            {l.status === 'PENDING' && (
              <div className="flex items-center gap-1">
                <select className="input w-auto text-sm" value={pick[l.id] ?? l.substitute?.id ?? ''} onChange={(e) => setPick({ ...pick, [l.id]: e.target.value })} aria-label="代課教練">
                  <option value="">選擇代課教練</option>
                  {coaches.filter((c) => c.id !== l.coach.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn-primary text-xs py-1.5 px-2 flex items-center gap-1" onClick={() => review(l, 'approve')}><Check className="w-3.5 h-3.5" />核准</button>
                <button className="btn-secondary text-xs py-1.5 px-2 flex items-center gap-1" onClick={() => review(l, 'reject')}><X className="w-3.5 h-3.5" />退回</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

