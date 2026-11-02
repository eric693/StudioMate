import { useCallback, useEffect, useState } from 'react';
import { Video, UserRound } from 'lucide-react';
import memberApi, { errorText } from './memberApi';
import { BOOKING_STATUS, addDays, dateTime, hm, localDay, shortDay } from '../../lib/format';
import { Me, MyBooking, Notify, Slot } from './types';

const weekdayOf = (d: string) => shortDay(d).replace(/^.*（(.)）$/, '$1');

function DayPicker({ days, day, setDay, count }: { days: string[]; day: string; setDay: (d: string) => void; count?: (d: string) => number }) {
  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar">
      {days.map((d) => {
        const n = count?.(d);
        const [, m, dd] = d.split('-');
        return (
          <button key={d} onClick={() => setDay(d)} className={`flex-shrink-0 w-14 py-2 rounded-xl text-center ${day === d ? 'bg-brand text-white' : 'bg-white text-gray-600'}`}>
            <div className="text-[11px] opacity-80">{weekdayOf(d)}</div>
            <div className="font-semibold">{+m}/{+dd}</div>
            {n !== undefined && <div className={`text-[10px] ${day === d ? 'opacity-80' : 'text-gray-400'}`}>{n ? `${n} 堂` : '—'}</div>}
          </button>
        );
      })}
    </div>
  );
}

const lateWarn = (me: Me, startsAt: string, status: string) => {
  const late = new Date(startsAt).getTime() - Date.now() < me.studio.cancelDeadlineHours * 3600e3;
  return status === 'BOOKED' && late && me.studio.lateCancelForfeit ? `\n\n已超過開課前 ${me.studio.cancelDeadlineHours} 小時，取消將不退回堂數。` : '';
};

export default function ScheduleTab({ me, onChange }: { me: Me; onChange: Notify }) {
  const [mode, setMode] = useState<'group' | 'private'>('group');
  return (
    <div className="space-y-3">
      {me.features.private && (
        <div className="grid grid-cols-2 bg-gray-100 rounded-xl p-1 text-sm">
          <button onClick={() => setMode('group')} className={`py-1.5 rounded-lg ${mode === 'group' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>團體課</button>
          <button onClick={() => setMode('private')} className={`py-1.5 rounded-lg ${mode === 'private' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>私人課</button>
        </div>
      )}
      {mode === 'group' ? <GroupSchedule me={me} onChange={onChange} /> : <PrivateSchedule me={me} onChange={onChange} />}
    </div>
  );
}

function GroupSchedule({ me, onChange }: { me: Me; onChange: Notify }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState(localDay());
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => memberApi.get('/schedule').then((r) => setSlots(r.data)), []);
  useEffect(() => { load(); }, [load]);
  if (!slots) return <p className="text-sm text-gray-400">載入中…</p>;

  const shown = slots.filter((s) => !branch || s.branch?.id === branch);
  const days = Array.from(new Set([localDay(), ...shown.map((s) => localDay(s.startsAt))])).sort();
  const list = shown.filter((s) => localDay(s.startsAt) === day);

  async function book(s: Slot) {
    setBusy(s.id);
    try {
      const r = await memberApi.post('/bookings', { sessionId: s.id });
      onChange(r.data.status === 'WAITLIST' ? '已排入候補，有名額時會自動遞補並通知你' : `預約成功：${shortDay(localDay(s.startsAt))} ${hm(s.startsAt)} ${s.classType.name}`);
      await load();
    } catch (e) { onChange(errorText(e)); }
    setBusy('');
  }
  async function cancel(s: Slot) {
    if (!confirm(`取消 ${hm(s.startsAt)} ${s.classType.name}？${lateWarn(me, s.startsAt, s.myBooking!.status)}`)) return;
    setBusy(s.id);
    try {
      const r = await memberApi.post(`/bookings/${s.myBooking!.id}/cancel`);
      onChange(r.data.refunded ? '已取消，堂數已退回' : r.data.late ? '已取消（晚取消，堂數不退回）' : '已取消');
      await load();
    } catch (e) { onChange(errorText(e)); }
    setBusy('');
  }

  return (
    <div className="space-y-3">
      {me.features.branches.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {[{ id: '', name: '全部分店' }, ...me.features.branches].map((b) => (
            <button key={b.id} onClick={() => setBranch(b.id)} className={`flex-shrink-0 px-3 py-1 rounded-full text-xs ${branch === b.id ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>{b.name}</button>
          ))}
        </div>
      )}
      <DayPicker days={days} day={day} setDay={setDay} count={(d) => shown.filter((s) => localDay(s.startsAt) === d).length} />
      {list.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">這天沒有可預約的課程</div> : list.map((s) => {
        const mine = s.myBooking;
        return (
          <div key={s.id} className="card flex items-center gap-3">
            <span className="w-1.5 self-stretch rounded-full" style={{ background: s.classType.color }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2"><span className="font-mono text-gray-700">{hm(s.startsAt)}</span><span className="font-medium text-gray-800 truncate">{s.classType.name}</span>
                {s.live && <Video className="w-3.5 h-3.5 text-sky-500 self-center" aria-label="線上直播" />}</div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{s.coach ?? '教練待定'}{s.branch ? `・${s.branch.name}` : ''}{s.room ? `・${s.room}` : ''}{s.classType.creditCost !== 1 ? `・扣 ${s.classType.creditCost} 堂` : ''}</div>
              <div className={`text-xs mt-0.5 ${s.spotsLeft ? 'text-gray-500' : 'text-brand'}`}>{s.spotsLeft ? `剩 ${s.spotsLeft} 位` : `額滿${s.waitlist ? `・候補 ${s.waitlist} 人` : ''}`}</div>
            </div>
            {mine ? (
              <div className="flex flex-col items-end gap-1">
                <span className={`text-xs px-2 py-0.5 rounded-full ${BOOKING_STATUS[mine.status].cls}`}>{BOOKING_STATUS[mine.status].label}</span>
                <button className="text-xs text-gray-400 underline" disabled={busy === s.id} onClick={() => cancel(s)}>取消</button>
              </div>
            ) : (
              <button className={s.spotsLeft ? 'btn-primary text-sm px-4' : 'btn-secondary text-sm px-3'} disabled={busy === s.id} onClick={() => book(s)}>
                {busy === s.id ? '…' : s.spotsLeft ? '預約' : '候補'}
              </button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-400 text-center pt-2">可預約 {me.studio.bookingWindowDays} 天內的課程・開課前 {me.studio.cancelDeadlineHours} 小時可免費取消</p>
    </div>
  );
}

interface PrivateOptions { types: { id: string; name: string; color: string; durationMin: number; creditCost: number }[]; coaches: { id: string; name: string; color: string }[] }

function PrivateSchedule({ me, onChange }: { me: Me; onChange: Notify }) {
  const [opts, setOpts] = useState<PrivateOptions | null>(null);
  const [typeId, setTypeId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [day, setDay] = useState(localDay());
  const [slots, setSlots] = useState<string[] | null>(null);
  const days = Array.from({ length: me.studio.bookingWindowDays + 1 }, (_, i) => addDays(localDay(), i));
  useEffect(() => {
    memberApi.get('/private/options').then((r) => { setOpts(r.data); setTypeId(r.data.types[0]?.id ?? ''); setCoachId(r.data.coaches[0]?.id ?? ''); });
  }, []);
  const loadSlots = useCallback(() => {
    if (!typeId || !coachId) return;
    setSlots(null);
    memberApi.get('/private/slots', { params: { classTypeId: typeId, coachId, date: day } }).then((r) => setSlots(r.data)).catch(() => setSlots([]));
  }, [typeId, coachId, day]);
  useEffect(loadSlots, [loadSlots]);
  if (!opts) return <p className="text-sm text-gray-400">載入中…</p>;
  if (!opts.types.length || !opts.coaches.length) return <div className="card text-sm text-gray-400 text-center py-8">目前沒有開放預約的私人課</div>;
  const type = opts.types.find((t) => t.id === typeId);
  const coach = opts.coaches.find((c) => c.id === coachId);

  async function book(time: string) {
    if (!confirm(`預約 ${shortDay(day)} ${time} ${coach?.name} 的${type?.name}？${type && type.creditCost !== 1 ? `\n（扣 ${type.creditCost} 堂）` : ''}`)) return;
    try {
      await memberApi.post('/private/book', { classTypeId: typeId, coachId, date: day, startTime: time });
      onChange(`預約成功：${shortDay(day)} ${time} ${type?.name}`);
      loadSlots();
    } catch (e) { onChange(errorText(e)); loadSlots(); }
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div>
          <div className="text-xs text-gray-400 mb-1.5">課程</div>
          <div className="flex flex-wrap gap-2">{opts.types.map((t) => (
            <button key={t.id} onClick={() => setTypeId(t.id)} className={`px-3 py-1.5 rounded-xl text-sm border ${typeId === t.id ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-600'}`}>{t.name}<span className="text-xs text-gray-400 ml-1">{t.durationMin} 分</span></button>
          ))}</div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1.5">教練</div>
          <div className="flex flex-wrap gap-2">{opts.coaches.map((c) => (
            <button key={c.id} onClick={() => setCoachId(c.id)} className={`px-3 py-1.5 rounded-xl text-sm border flex items-center gap-1 ${coachId === c.id ? 'border-brand bg-brand/5 text-brand' : 'border-gray-200 text-gray-600'}`}><UserRound className="w-3.5 h-3.5" />{c.name}</button>
          ))}</div>
        </div>
      </div>
      <DayPicker days={days} day={day} setDay={setDay} />
      <div className="card">
        {!slots ? <p className="text-sm text-gray-400">載入中…</p> : slots.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">這天沒有空檔，請選其他日期或教練</p> : (
          <div className="grid grid-cols-4 gap-2">{slots.map((t) => <button key={t} className="btn-secondary text-sm py-2" onClick={() => book(t)}>{t}</button>)}</div>
        )}
      </div>
      <p className="text-xs text-gray-400 text-center">私人課取消規則與團體課相同：開課前 {me.studio.cancelDeadlineHours} 小時可免費取消</p>
    </div>
  );
}

export function BookingsTab({ me, onChange }: { me: Me; onChange: Notify }) {
  const [scope, setScope] = useState<'upcoming' | 'history'>('upcoming');
  const [list, setList] = useState<MyBooking[] | null>(null);
  const load = useCallback(() => memberApi.get('/bookings', { params: { scope } }).then((r) => setList(r.data)), [scope]);
  useEffect(() => { setList(null); load(); }, [load]);

  async function cancel(b: MyBooking) {
    if (!confirm(`取消 ${dateTime(b.startsAt)} ${b.classType}？${lateWarn(me, b.startsAt, b.status)}`)) return;
    try {
      const r = await memberApi.post(`/bookings/${b.id}/cancel`);
      onChange(r.data.refunded ? '已取消，堂數已退回' : r.data.late ? '已取消（晚取消，堂數不退回）' : '已取消');
      load();
    } catch (e) { onChange(errorText(e)); }
  }
  async function joinLive(b: MyBooking) {
    // 先開視窗再填網址，避免手機瀏覽器擋掉非使用者觸發的彈出視窗
    const w = window.open('', '_blank');
    try {
      const r = await memberApi.get(`/bookings/${b.id}/live`);
      if (w) w.location.href = r.data.url; else location.href = r.data.url;
    } catch (e) { w?.close(); onChange(errorText(e)); }
  }
  const liveOpen = (b: MyBooking) => b.live && Date.now() >= new Date(b.startsAt).getTime() - 15 * 60e3 && Date.now() <= new Date(b.endsAt).getTime();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 bg-gray-100 rounded-xl p-1 text-sm">
        {(['upcoming', 'history'] as const).map((k) => (
          <button key={k} onClick={() => setScope(k)} className={`py-1.5 rounded-lg ${scope === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{k === 'upcoming' ? '即將上課' : '過去紀錄'}</button>
        ))}
      </div>
      {!list ? <p className="text-sm text-gray-400">載入中…</p> : list.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">{scope === 'upcoming' ? '還沒有預約，到「預約」選一堂課吧' : '還沒有上課紀錄'}</div> : list.map((b) => (
        <div key={b.id} className="card flex items-center gap-3">
          <span className="w-1.5 self-stretch rounded-full" style={{ background: b.color }} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-800 truncate flex items-center gap-1">{b.classType}
              {b.isPrivate && <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 rounded">私人課</span>}
              {b.live && <Video className="w-3.5 h-3.5 text-sky-500" aria-label="線上直播" />}</div>
            <div className="text-xs text-gray-500">{dateTime(b.startsAt)}</div>
            <div className="text-xs text-gray-400 truncate">{b.coach ?? '教練待定'}{b.branch ? `・${b.branch}` : ''}{b.room ? `・${b.room}` : ''}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${BOOKING_STATUS[b.status].cls}`}>{BOOKING_STATUS[b.status].label}</span>
            {scope === 'upcoming' && liveOpen(b) && <button className="btn-primary text-xs py-1 px-2 flex items-center gap-1" onClick={() => joinLive(b)}><Video className="w-3.5 h-3.5" />進入直播</button>}
            {scope === 'upcoming' && ['BOOKED', 'WAITLIST'].includes(b.status) && new Date(b.startsAt) > new Date() && <button className="text-xs text-gray-400 underline" onClick={() => cancel(b)}>取消</button>}
          </div>
        </div>
      ))}
      {scope === 'upcoming' && list?.some((b) => b.live) && <p className="text-xs text-gray-400 text-center">直播課開課前 15 分鐘會出現「進入直播」按鈕</p>}
    </div>
  );
}
