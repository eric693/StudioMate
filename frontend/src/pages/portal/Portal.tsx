import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ListChecks, ShoppingBag, UserRound, LogOut, Dumbbell, CheckCircle2 } from 'lucide-react';
import memberApi, { MEMBER_TOKEN, errorText } from './memberApi';
import { setTimeZone, dateTime } from '../../lib/format';
import { Me } from './types';
import ScheduleTab, { BookingsTab } from './ScheduleTab';
import ShopTab from './ShopTab';
import MeTab from './MeTab';
import { AnnouncementBar } from './MoreSections';
import { registerServiceWorker } from './pwa';
import { passText } from '../../lib/format';

declare global { interface Window { liff?: { init(o: { liffId: string }): Promise<void>; isLoggedIn(): boolean; login(): void; getAccessToken(): string | null } } }

// 掃描櫃檯簽到 QR code 進來（/m?checkin=token）：還沒登入時先記住，登入後再簽到
const CHECKIN_KEY = 'pendingCheckin';
function takeUrlParams() {
  const p = new URLSearchParams(location.search);
  const checkin = p.get('checkin');
  if (checkin) { try { sessionStorage.setItem(CHECKIN_KEY, checkin); } catch { /* 無痕模式 */ } }
  const order = p.get('order');
  if (checkin || order) history.replaceState(null, '', '/m');
  return { order };
}

/** 會員端可加到手機主畫面（像 App 一樣全螢幕開啟） */
function useInstallable() {
  useEffect(() => {
    const add = (tag: string, attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      document.head.appendChild(el);
      return el;
    };
    const els = [
      add('link', { rel: 'manifest', href: '/member.webmanifest' }),
      add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      add('meta', { name: 'apple-mobile-web-app-title', content: '會員預約' }),
      add('meta', { name: 'theme-color', content: '#d9573b' }),
      add('link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }),
    ];
    registerServiceWorker();
    return () => els.forEach((e) => e.remove());
  }, []);
}

export default function Portal() {
  useInstallable();
  const [token, setToken] = useState(() => localStorage.getItem(MEMBER_TOKEN));
  const [params] = useState(takeUrlParams);
  if (!token) return <MemberLogin onLogin={(t) => { localStorage.setItem(MEMBER_TOKEN, t); setToken(t); }} />;
  return <MemberHome orderId={params.order} onLogout={() => { localStorage.removeItem(MEMBER_TOKEN); setToken(null); }} />;
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

type Tab = 'schedule' | 'bookings' | 'shop' | 'me';

function MemberHome({ onLogout, orderId }: { onLogout: () => void; orderId: string | null }) {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>(orderId ? 'shop' : 'schedule');
  const [toast, setToast] = useState('');
  const [checkIn, setCheckIn] = useState<{ ok: boolean; text: string } | null>(null);
  // 斷線提示；恢復連線時重新載入會員資料
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = () => { setOffline(false); loadMe(); };
    const off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMe = useCallback(() => memberApi.get('/me').then((r) => { setTimeZone(r.data.studio.timezone); setMe(r.data); }), []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  // 掃碼簽到
  useEffect(() => {
    let token: string | null = null;
    try { token = sessionStorage.getItem(CHECKIN_KEY); sessionStorage.removeItem(CHECKIN_KEY); } catch { /* 無痕模式 */ }
    if (!token) return;
    memberApi.post('/checkin', { token })
      .then((r) => setCheckIn({ ok: true, text: `${r.data.already ? '已經簽到過了' : '簽到成功'}：${r.data.time} ${r.data.className}` }))
      .catch((e) => setCheckIn({ ok: false, text: errorText(e) }));
  }, []);

  if (!me) return <Shell><div className="p-6 text-sm text-gray-400">載入中…</div></Shell>;
  const notify = (m: string) => { setToast(m); loadMe(); };
  const TABS: [Tab, string, React.ElementType][] = [
    ['schedule', '預約', CalendarDays], ['bookings', '我的課', ListChecks],
    ...(me.features.shop ? [['shop', '購買', ShoppingBag] as [Tab, string, React.ElementType]] : []),
    ['me', '我的', UserRound],
  ];
  return (
    <Shell>
      <header className="bg-brand text-white px-5 pt-6 pb-5 pt-safe">
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-90">{me.studio.name}</div>
          <button onClick={onLogout} className="p-1 opacity-80" aria-label="登出"><LogOut className="w-4 h-4" /></button>
        </div>
        <div className="text-xl font-bold mt-1">{me.member.name}，你好</div>
        <div className="text-sm opacity-90 mt-1">
          {me.passes.length ? me.passes.slice(0, 2).map((p) => <div key={p.id}>{p.planName}：{passText(p)}</div>)
            : me.features.shop ? <button className="underline" onClick={() => setTab('shop')}>目前沒有有效方案，前往購買</button> : '目前沒有有效方案，請洽櫃檯購買'}
        </div>
        {me.suspendedUntil && <div className="mt-2 text-xs bg-white/20 rounded-lg px-2 py-1">因近期未到課，線上預約暫停至 {dateTime(me.suspendedUntil)}，如需預約請聯絡教室</div>}
      </header>
      {offline && <div className="bg-gray-800 text-white text-xs text-center py-1.5">目前離線，畫面可能不是最新狀態；連線後會自動更新</div>}
      <main className="px-4 py-4 pb-24 space-y-3">
        {tab === 'schedule' && <AnnouncementBar />}
        {tab === 'schedule' && <ScheduleTab me={me} onChange={notify} />}
        {tab === 'bookings' && <BookingsTab me={me} onChange={notify} />}
        {tab === 'shop' && <ShopTab me={me} orderId={orderId} onChange={notify} />}
        {tab === 'me' && <MeTab me={me} onChange={notify} />}
      </main>
      {toast && <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-2xl shadow-lg w-max max-w-[90vw] text-center z-50">{toast}</div>}
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 pb-safe z-40">
        <div className="max-w-md mx-auto flex">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${tab === k ? 'text-brand' : 'text-gray-400'}`}>
              <Icon className="w-5 h-5" />{label}
            </button>
          ))}
        </div>
      </nav>
      {me.terms && <TermsGate terms={me.terms} onAccepted={loadMe} />}
      {checkIn && !me.terms && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6" onClick={() => setCheckIn(null)}>
          <div className="bg-white rounded-2xl p-6 text-center max-w-sm w-full">
            <CheckCircle2 className={`w-14 h-14 mx-auto ${checkIn.ok ? 'text-green-500' : 'text-gray-300'}`} />
            <div className="text-lg font-semibold text-gray-800 mt-3">{checkIn.ok ? '簽到完成' : '無法簽到'}</div>
            <p className="text-sm text-gray-500 mt-1">{checkIn.text}</p>
            <button className="btn-primary w-full mt-5">好</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** 會員條款：第一次使用或條款改版時，需同意才能繼續 */
function TermsGate({ terms, onAccepted }: { terms: { text: string; version: number }; onAccepted: () => void }) {
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  async function accept() {
    try { await memberApi.post('/terms', { version: terms.version }); onAccepted(); } catch (e) { setErr(errorText(e)); }
  }
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] flex flex-col" role="dialog" aria-label="會員條款">
        <div className="px-5 py-4 border-b border-gray-100"><h2 className="font-semibold text-gray-800">會員條款</h2><p className="text-xs text-gray-400">請閱讀並同意後繼續使用預約與購買功能</p></div>
        <div className="px-5 py-4 overflow-y-auto text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{terms.text}</div>
        <div className="px-5 py-4 border-t border-gray-100 space-y-3 pb-safe">
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />我已閱讀並同意以上條款</label>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button className="btn-primary w-full py-3" disabled={!agree} onClick={accept}>同意並繼續</button>
        </div>
      </div>
    </div>
  );
}
