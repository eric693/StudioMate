import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ListChecks, Ticket, LogOut, MapPin, Phone, Dumbbell } from 'lucide-react';
import memberApi, { MEMBER_TOKEN, errorText } from './memberApi';
import { BOOKING_STATUS, PLAN_KIND, dateTime, hm, localDay, setTimeZone, shortDay, passText } from '../../lib/format';
import { BookingStatus, Membership } from '../../types';

interface Me {
  member: { id: string; name: string; phone: string };
  studio: { name: string; phone: string | null; address: string | null; cancelDeadlineHours: number; lateCancelForfeit: boolean; bookingWindowDays: number; timezone: string };
  passes: Membership[];
}
interface Slot {
  id: string; startsAt: string; endsAt: string; room: string | null; coach: string | null; capacity: number; spotsLeft: number; waitlist: number;
  classType: { id: string; name: string; color: string; creditCost: number }; myBooking: { id: string; status: BookingStatus } | null;
}
interface MyBooking { id: string; status: BookingStatus; startsAt: string; classType: string; color: string; coach: string | null; room: string | null; creditsCharged: number }

declare global { interface Window { liff?: { init(o: { liffId: string }): Promise<void>; isLoggedIn(): boolean; login(): void; getAccessToken(): string | null } } }

export default function Portal() {
  const [token, setToken] = useState(() => localStorage.getItem(MEMBER_TOKEN));
  if (!token) return <MemberLogin onLogin={(t) => { localStorage.setItem(MEMBER_TOKEN, t); setToken(t); }} />;
  return <MemberHome onLogout={() => { localStorage.removeItem(MEMBER_TOKEN); setToken(null); }} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50"><div className="max-w-md mx-auto min-h-screen bg-gray-50">{children}</div></div>;
}

function MemberLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 已設定 LIFF（從 LINE 開啟）時自動以 LINE 身分登入
  useEffect(() => {
    memberApi.get('/config').then(async ({ data }) => {
      if (!data.liffEnabled || !data.liffId) return;
      await new Promise<void>((ok, fail) => {
        const s = document.createElement('script');
        s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
        s.onload = () => ok(); s.onerror = () => fail();
        document.head.appendChild(s);
      });
      await window.liff!.init({ liffId: data.liffId });
      if (!window.liff!.isLoggedIn()) { window.liff!.login(); return; }
      setBusy(true);
      const r = await memberApi.post('/login', { liffAccessToken: window.liff!.getAccessToken() });
      onLogin(r.data.token);
    }).catch((e) => { setBusy(false); if (e?.response) setErr(errorText(e)); });
  }, [onLogin]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await memberApi.post('/login', { bindingCode: code });
      onLogin(r.data.token);
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  }
  return (
    <Shell>
      <div className="px-6 pt-20 pb-10">
        <div className="w-14 h-14 rounded-2xl bg-brand flex items-center justify-center mb-6"><Dumbbell className="w-7 h-7 text-white" /></div>
        <h1 className="text-2xl font-bold text-gray-800">會員預約</h1>
        <p className="text-sm text-gray-500 mt-1">請輸入教室提供的 6 碼綁定碼</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <input className="input text-center font-mono text-2xl tracking-[0.4em] uppercase py-3" maxLength={6} autoComplete="one-time-code" autoCapitalize="characters"
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABC123" aria-label="綁定碼" />
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button className="btn-primary w-full py-3" disabled={busy || code.length !== 6}>{busy ? '登入中…' : '登入'}</button>
        </form>
        <p className="text-xs text-gray-400 mt-6 leading-relaxed">沒有綁定碼？請洽教室櫃檯為您產生。綁定碼 24 小時內有效，登入後會保持登入狀態。</p>
      </div>
    </Shell>
  );
}

type Tab = 'schedule' | 'bookings' | 'passes';

function MemberHome({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('schedule');
  const [toast, setToast] = useState('');
  const loadMe = useCallback(() => memberApi.get('/me').then((r) => { setTimeZone(r.data.studio.timezone); setMe(r.data); }), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);
  if (!me) return <Shell><div className="p-6 text-sm text-gray-400">載入中…</div></Shell>;

  const TABS: [Tab, string, React.ElementType][] = [['schedule', '課表', CalendarDays], ['bookings', '我的預約', ListChecks], ['passes', '我的方案', Ticket]];
  return (
    <Shell>
      <header className="bg-brand text-white px-5 pt-6 pb-5 pt-safe">
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-90">{me.studio.name}</div>
          <button onClick={onLogout} className="p-1 opacity-80" aria-label="登出"><LogOut className="w-4 h-4" /></button>
        </div>
        <div className="text-xl font-bold mt-1">{me.member.name}，你好</div>
        <div className="text-sm opacity-90 mt-1">
          {me.passes.length ? me.passes.slice(0, 2).map((p) => <div key={p.id}>{p.planName}：{passText(p)}</div>) : '目前沒有有效方案，請洽櫃檯購買'}
        </div>
      </header>
      <main className="px-4 py-4 pb-24">
        {tab === 'schedule' && <ScheduleTab me={me} onChange={(m) => { setToast(m); loadMe(); }} />}
        {tab === 'bookings' && <BookingsTab me={me} onChange={(m) => { setToast(m); loadMe(); }} />}
        {tab === 'passes' && <PassesTab me={me} />}
      </main>
      {toast && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg max-w-[90vw] text-center z-50">{toast}</div>}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 pb-safe z-40">
        <div className="max-w-md mx-auto grid grid-cols-3">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex flex-col items-center gap-0.5 py-2 text-xs ${tab === k ? 'text-brand' : 'text-gray-400'}`}>
              <Icon className="w-5 h-5" />{label}
            </button>
          ))}
        </div>
      </nav>
    </Shell>
  );
}

function ScheduleTab({ me, onChange }: { me: Me; onChange: (msg: string) => void }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState(localDay());
  const [busy, setBusy] = useState('');
  const load = useCallback(() => memberApi.get('/schedule').then((r) => setSlots(r.data)), []);
  useEffect(() => { load(); }, [load]);
  if (!slots) return <p className="text-sm text-gray-400">載入中…</p>;

  const days = Array.from(new Set([localDay(), ...slots.map((s) => localDay(s.startsAt))])).sort();
  const list = slots.filter((s) => localDay(s.startsAt) === day);

  async function book(s: Slot) {
    setBusy(s.id);
    try {
      const r = await memberApi.post('/bookings', { sessionId: s.id });
      onChange(r.data.status === 'WAITLIST' ? `已排入候補，有名額時會自動遞補並通知你` : `預約成功：${shortDay(localDay(s.startsAt))} ${hm(s.startsAt)} ${s.classType.name}`);
      await load();
    } catch (e) { onChange(errorText(e)); }
    setBusy('');
  }
  async function cancel(s: Slot) {
    const late = new Date(s.startsAt).getTime() - Date.now() < me.studio.cancelDeadlineHours * 3600e3;
    const warn = s.myBooking!.status === 'BOOKED' && late && me.studio.lateCancelForfeit ? `\n\n已超過開課前 ${me.studio.cancelDeadlineHours} 小時，取消將不退回堂數。` : '';
    if (!confirm(`取消 ${hm(s.startsAt)} ${s.classType.name}？${warn}`)) return;
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
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar">
        {days.map((d) => {
          const n = slots.filter((s) => localDay(s.startsAt) === d).length;
          const [, m, dd] = d.split('-');
          return (
            <button key={d} onClick={() => setDay(d)} className={`flex-shrink-0 w-14 py-2 rounded-xl text-center ${day === d ? 'bg-brand text-white' : 'bg-white text-gray-600'}`}>
              <div className="text-[11px] opacity-80">{shortDay(d).replace(/^.*（(.)）$/, '$1')}</div>
              <div className="font-semibold">{+m}/{+dd}</div>
              <div className={`text-[10px] ${day === d ? 'opacity-80' : 'text-gray-400'}`}>{n ? `${n} 堂` : '—'}</div>
            </button>
          );
        })}
      </div>
      {list.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">這天沒有可預約的課程</div> : list.map((s) => {
        const mine = s.myBooking;
        return (
          <div key={s.id} className="card flex items-center gap-3">
            <span className="w-1.5 self-stretch rounded-full" style={{ background: s.classType.color }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2"><span className="font-mono text-gray-700">{hm(s.startsAt)}</span><span className="font-medium text-gray-800 truncate">{s.classType.name}</span></div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{s.coach ?? '教練待定'}{s.room ? `・${s.room}` : ''}{s.classType.creditCost !== 1 ? `・扣 ${s.classType.creditCost} 堂` : ''}</div>
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

function BookingsTab({ me, onChange }: { me: Me; onChange: (msg: string) => void }) {
  const [scope, setScope] = useState<'upcoming' | 'history'>('upcoming');
  const [list, setList] = useState<MyBooking[] | null>(null);
  const load = useCallback(() => memberApi.get('/bookings', { params: { scope } }).then((r) => setList(r.data)), [scope]);
  useEffect(() => { setList(null); load(); }, [load]);

  async function cancel(b: MyBooking) {
    const late = new Date(b.startsAt).getTime() - Date.now() < me.studio.cancelDeadlineHours * 3600e3;
    const warn = b.status === 'BOOKED' && late && me.studio.lateCancelForfeit ? `\n\n已超過開課前 ${me.studio.cancelDeadlineHours} 小時，取消將不退回堂數。` : '';
    if (!confirm(`取消 ${dateTime(b.startsAt)} ${b.classType}？${warn}`)) return;
    try {
      const r = await memberApi.post(`/bookings/${b.id}/cancel`);
      onChange(r.data.refunded ? '已取消，堂數已退回' : r.data.late ? '已取消（晚取消，堂數不退回）' : '已取消');
      load();
    } catch (e) { onChange(errorText(e)); }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 bg-gray-100 rounded-xl p-1 text-sm">
        {(['upcoming', 'history'] as const).map((k) => (
          <button key={k} onClick={() => setScope(k)} className={`py-1.5 rounded-lg ${scope === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{k === 'upcoming' ? '即將上課' : '過去紀錄'}</button>
        ))}
      </div>
      {!list ? <p className="text-sm text-gray-400">載入中…</p> : list.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">{scope === 'upcoming' ? '還沒有預約，到「課表」選一堂課吧' : '還沒有上課紀錄'}</div> : list.map((b) => (
        <div key={b.id} className="card flex items-center gap-3">
          <span className="w-1.5 self-stretch rounded-full" style={{ background: b.color }} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-800 truncate">{b.classType}</div>
            <div className="text-xs text-gray-500">{dateTime(b.startsAt)}</div>
            <div className="text-xs text-gray-400 truncate">{b.coach ?? '教練待定'}{b.room ? `・${b.room}` : ''}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${BOOKING_STATUS[b.status].cls}`}>{BOOKING_STATUS[b.status].label}</span>
            {scope === 'upcoming' && <button className="text-xs text-gray-400 underline" onClick={() => cancel(b)}>取消</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PassesTab({ me }: { me: Me }) {
  return (
    <div className="space-y-3">
      {me.passes.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">目前沒有有效方案，請洽櫃檯購買</div> : me.passes.map((p) => (
        <div key={p.id} className="card">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800">{p.planName}</span>
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded">{PLAN_KIND[p.kind]}</span>
            {p.status === 'FROZEN' && <span className="text-xs bg-sky-50 text-sky-600 px-1.5 rounded">凍結中</span>}
          </div>
          <div className="mt-2">
            {p.kind === 'PERIOD' ? <span className="text-lg font-bold text-brand">不限堂數</span>
              : <><span className="text-3xl font-bold text-brand">{p.creditsLeft}</span><span className="text-sm text-gray-400"> / {p.creditsTotal} 堂</span></>}
          </div>
          {p.kind !== 'PERIOD' && p.creditsTotal ? (
            <div className="h-1.5 bg-gray-100 rounded-full mt-2"><div className="h-full bg-brand rounded-full" style={{ width: `${((p.creditsLeft ?? 0) / p.creditsTotal) * 100}%` }} /></div>
          ) : null}
          <div className="text-xs text-gray-400 mt-2">{p.startDate.slice(0, 10)} ~ {p.endDate.slice(0, 10)}{p.status === 'FROZEN' && p.frozenUntil ? `・凍結至 ${p.frozenUntil.slice(0, 10)}` : ''}</div>
        </div>
      ))}
      <div className="card text-sm text-gray-600 space-y-1.5">
        <div className="font-medium text-gray-700">{me.studio.name}</div>
        {me.studio.phone && <a href={`tel:${me.studio.phone}`} className="flex items-center gap-2 text-brand"><Phone className="w-4 h-4" />{me.studio.phone}</a>}
        {me.studio.address && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" />{me.studio.address}</div>}
      </div>
    </div>
  );
}
