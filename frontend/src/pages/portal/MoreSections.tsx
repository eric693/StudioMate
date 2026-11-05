// 會員端「我的」頁的新區塊：入場 QR code、問卷、定期定額、體組成、合約；首頁公告
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, ClipboardList, Repeat, Activity, FileSignature, Megaphone, Star, Smartphone, Download, Share, Bell } from 'lucide-react';
import { canPromptInstall, currentSubscription, disablePush, enablePush, isIOS, isStandalone, onInstallChange, promptInstall, pushSupported } from './pwa';
import memberApi, { errorText } from './memberApi';
import { SUB_STATUS, dateStr, dateTime, money } from '../../lib/format';
import { Notify } from './types';
import { MetricsTable } from '../MemberDetail';

/** 入場 QR code：每 30 秒自動更新，給櫃檯或閘門掃描 */
export function AccessCode() {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState('');
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout>;
    let tick: ReturnType<typeof setInterval>;
    const load = async () => {
      const r = await memberApi.get('/access-code');
      setSvg(await QRCode.toString(r.data.code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
      setLeft(r.data.expiresInSec);
      timer = setTimeout(load, r.data.expiresInSec * 1000);
    };
    load();
    tick = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => { clearTimeout(timer); clearInterval(tick); };
  }, [open]);
  return (
    <div className="card">
      <button className="w-full flex items-center gap-2 text-sm font-medium text-gray-700" onClick={() => setOpen(!open)}>
        <QrCode className="w-4 h-4 text-brand" />入場 QR code<span className="ml-auto text-xs text-brand">{open ? '收起' : '顯示'}</span>
      </button>
      {open && (
        <div className="mt-3 text-center">
          <div className="mx-auto w-56 h-56 bg-white" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-xs text-gray-400 mt-2">出示給櫃檯或對準閘門掃描・{left} 秒後自動更新（截圖無效）</p>
        </div>
      )}
    </div>
  );
}

interface PortalSurvey { id: string; title: string; sessionId: string | null; questions: { id: string; type: 'rating' | 'text' | 'choice'; label: string; options?: string[] }[]; session?: { startsAt: string; className: string; coach: string | null } }

export function SurveysCard({ onChange }: { onChange: Notify }) {
  const [list, setList] = useState<PortalSurvey[]>([]);
  const [open, setOpen] = useState<PortalSurvey | null>(null);
  const load = () => memberApi.get('/surveys').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  if (!list.length) return null;
  return (
    <div className="card">
      <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5"><ClipboardList className="w-4 h-4 text-brand" />問卷（{list.length}）</div>
      <div className="space-y-2">
        {list.map((s) => (
          <button key={`${s.id}${s.sessionId}`} className="w-full text-left bg-brand/5 rounded-xl px-3 py-2" onClick={() => setOpen(s)}>
            <div className="text-sm text-gray-800">{s.title}</div>
            {s.session && <div className="text-xs text-gray-500">{dateTime(s.session.startsAt)} {s.session.className}{s.session.coach ? `・${s.session.coach}` : ''}</div>}
          </button>
        ))}
      </div>
      {open && <SurveyForm s={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); onChange('感謝您的回饋！'); }} />}
    </div>
  );
}

function SurveyForm({ s, onClose, onDone }: { s: PortalSurvey; onClose: () => void; onDone: () => void }) {
  const [ans, setAns] = useState<Record<string, string | number>>({});
  const [err, setErr] = useState('');
  async function submit() {
    setErr('');
    try { await memberApi.post(`/surveys/${s.id}`, { sessionId: s.sessionId, answers: ans }); onDone(); } catch (e) { setErr(errorText(e)); }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] overflow-y-auto p-5 space-y-4 pb-safe" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={s.title}>
        <div><div className="font-semibold text-gray-800">{s.title}</div>{s.session && <div className="text-xs text-gray-500">{dateTime(s.session.startsAt)} {s.session.className}</div>}</div>
        {s.questions.map((q) => (
          <div key={q.id} className="space-y-1.5">
            <div className="text-sm text-gray-700">{q.label}</div>
            {q.type === 'rating' && (
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setAns({ ...ans, [q.id]: n })} aria-label={`${n} 分`}>
                    <Star className={`w-8 h-8 ${Number(ans[q.id] ?? 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
                  </button>
                ))}
              </div>
            )}
            {q.type === 'choice' && <div className="flex flex-wrap gap-2">{q.options!.map((o) => <button key={o} type="button" onClick={() => setAns({ ...ans, [q.id]: o })} className={`text-sm px-3 py-1.5 rounded-full border ${ans[q.id] === o ? 'border-brand bg-brand/10 text-brand' : 'border-gray-200 text-gray-600'}`}>{o}</button>)}</div>}
            {q.type === 'text' && <textarea className="input" rows={3} value={String(ans[q.id] ?? '')} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} />}
          </div>
        ))}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button className="btn-primary w-full py-3" onClick={submit}>送出</button>
      </div>
    </div>
  );
}

interface Sub { id: string; status: string; amount: number; successTimes: number; lastPaidAt: string | null; plan: { name: string } }

export function SubscriptionsCard({ onChange }: { onChange: Notify }) {
  const [list, setList] = useState<Sub[]>([]);
  const load = () => memberApi.get('/subscriptions').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  async function cancel(s: Sub) {
    if (!confirm(`停止「${s.plan.name}」每月自動扣款？目前的方案可以用到到期日。`)) return;
    try { await memberApi.post(`/subscriptions/${s.id}/cancel`); load(); onChange('已停止自動扣款'); } catch (e) { alert(errorText(e)); }
  }
  if (!list.length) return null;
  return (
    <div className="card">
      <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5"><Repeat className="w-4 h-4 text-brand" />每月自動扣款</div>
      {list.map((s) => (
        <div key={s.id} className="flex items-center justify-between py-1.5 text-sm">
          <div><div className="text-gray-800">{s.plan.name}<span className={`text-[11px] px-1.5 rounded-full ml-2 ${SUB_STATUS[s.status].cls}`}>{SUB_STATUS[s.status].label}</span></div><div className="text-xs text-gray-400">每月 {money(s.amount)}・已扣 {s.successTimes} 期</div></div>
          {['ACTIVE', 'PAST_DUE'].includes(s.status) && <button className="text-xs text-gray-500 underline" onClick={() => cancel(s)}>停止扣款</button>}
        </div>
      ))}
    </div>
  );
}

export function MetricsCard() {
  const [list, setList] = useState<Parameters<typeof MetricsTable>[0]['list']>([]);
  useEffect(() => { memberApi.get('/metrics').then((r) => setList(r.data)); }, []);
  if (!list.length) return null;
  const last = list[0];
  return (
    <div className="card">
      <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5"><Activity className="w-4 h-4 text-brand" />體組成<span className="text-xs text-gray-400 font-normal ml-auto">{dateStr(last.measuredAt)} 量測</span></div>
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        {[['體重', last.weightKg, 'kg'], ['體脂率', last.bodyFatPct, '%'], ['肌肉量', last.muscleKg, 'kg']].map(([l, v, u]) => (
          <div key={l as string} className="bg-gray-50 rounded-xl py-2"><div className="text-[11px] text-gray-400">{l}</div><div className="text-lg font-bold text-gray-800">{v ?? '—'}<span className="text-xs text-gray-400 font-normal">{v != null ? u : ''}</span></div></div>
        ))}
      </div>
      {list.length > 1 && <MetricsTable list={list} />}
    </div>
  );
}

interface Contract { id: string; title: string; content: string; signature: string; signerName: string; signedAt: string }

export function ContractsCard() {
  const [list, setList] = useState<Contract[]>([]);
  const [open, setOpen] = useState<Contract | null>(null);
  useEffect(() => { memberApi.get('/contracts').then((r) => setList(r.data)); }, []);
  if (!list.length) return null;
  return (
    <div className="card">
      <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5"><FileSignature className="w-4 h-4 text-brand" />合約</div>
      {list.map((c) => <button key={c.id} className="w-full flex justify-between py-1.5 text-sm text-left" onClick={() => setOpen(c)}><span className="text-gray-700">{c.title}</span><span className="text-xs text-gray-400">{dateStr(c.signedAt)}</span></button>)}
      {open && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setOpen(null)}>
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90dvh] overflow-y-auto p-5 pb-safe" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={open.title}>
            <div className="font-semibold text-gray-800 mb-2">{open.title}</div>
            <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{open.content}</div>
            <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-400">簽署人 {open.signerName}・{dateTime(open.signedAt)}</div>
            <img src={open.signature} alt="簽名" className="h-20" />
            <button className="btn-secondary w-full mt-3" onClick={() => setOpen(null)}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Ann { id: string; title: string; body: string; pinned: boolean; createdAt: string }

/** 首頁公告：顯示置頂與最新一則，點開看全部 */
export function AnnouncementBar() {
  const [list, setList] = useState<Ann[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => { memberApi.get('/announcements').then((r) => setList(r.data)).catch(() => undefined); }, []);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 1);
  return (
    <div className="card bg-amber-50 space-y-2">
      {shown.map((a) => (
        <div key={a.id}>
          <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Megaphone className="w-4 h-4 text-amber-600" />{a.title}</div>
          <div className="text-xs text-gray-600 whitespace-pre-wrap mt-0.5">{a.body}</div>
          <div className="text-[11px] text-gray-400">{dateTime(a.createdAt)}</div>
        </div>
      ))}
      {list.length > 1 && <button className="text-xs text-amber-700" onClick={() => setAll(!all)}>{all ? '收起' : `查看全部 ${list.length} 則公告`}</button>}
    </div>
  );
}

/** 安裝到手機主畫面與手機通知 */
export function AppCard({ onChange }: { onChange: Notify }) {
  const [, force] = useState(0);
  const [cfg, setCfg] = useState<{ enabled: boolean; publicKey: string | null } | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  useEffect(() => {
    memberApi.get('/push').then((r) => setCfg(r.data)).catch(() => undefined);
    currentSubscription().then((s) => setSubscribed(Boolean(s))).catch(() => undefined);
  }, []);
  const standalone = isStandalone();
  const ios = isIOS();
  // iPhone 只有加到主畫面後才能收通知
  const pushPossible = pushSupported() && !(ios && !standalone);

  async function install() {
    if (canPromptInstall()) { if (await promptInstall()) onChange('已加到主畫面'); return; }
    setIosHelp(true);
  }
  async function togglePush() {
    setErr(''); setBusy(true);
    try {
      if (subscribed) { await disablePush(); setSubscribed(false); onChange('已關閉手機通知'); }
      else { await enablePush(cfg!.publicKey!); setSubscribed(true); await memberApi.post('/push/test'); onChange('手機通知已開啟，已送出一則測試通知'); }
    } catch (e) { setErr(e instanceof Error && !('response' in e) ? e.message : errorText(e)); }
    setBusy(false);
  }

  return (
    <div className="card space-y-3">
      <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Smartphone className="w-4 h-4 text-brand" />App 與通知</div>
      {standalone ? <p className="text-xs text-green-600">已從主畫面開啟，像 App 一樣使用。</p> : (
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl" />
          <div className="flex-1 text-xs text-gray-500">加到手機主畫面，下次一點就開，不用再找網址</div>
          <button className="btn-primary text-sm py-1.5 flex items-center gap-1" onClick={install}><Download className="w-4 h-4" />安裝</button>
        </div>
      )}
      {iosHelp && !standalone && (
        <div className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3 space-y-1">
          {ios ? <>
            <div className="font-medium text-gray-700">iPhone／iPad 加到主畫面</div>
            <div>1. 用 Safari 開啟這個網頁</div>
            <div>2. 點下方的「分享」按鈕 <Share className="w-3.5 h-3.5 inline" /></div>
            <div>3. 選「加入主畫面」，再按「新增」</div>
          </> : <>
            <div className="font-medium text-gray-700">加到主畫面</div>
            <div>點瀏覽器右上角的選單「⋮」，選「安裝應用程式」或「加到主畫面」。</div>
          </>}
        </div>
      )}
      {cfg?.enabled && (
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center gap-3">
            <Bell className={`w-5 h-5 ${subscribed ? 'text-brand' : 'text-gray-300'}`} />
            <div className="flex-1 text-xs text-gray-500">{subscribed ? '已開啟：上課提醒、候補遞補、停課等通知會推到這支手機' : '開啟後，上課提醒、候補遞補、停課等通知會直接推到手機'}</div>
            {pushPossible && <button className={subscribed ? 'btn-secondary text-sm py-1.5' : 'btn-primary text-sm py-1.5'} disabled={busy} onClick={togglePush}>{busy ? '處理中…' : subscribed ? '關閉' : '開啟通知'}</button>}
          </div>
          {!pushPossible && <p className="text-xs text-amber-600 mt-2">{ios ? 'iPhone 需要先「加到主畫面」，再從主畫面開啟後才能開啟通知（iOS 16.4 以上）。' : '這個瀏覽器不支援手機通知。'}</p>}
          {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
        </div>
      )}
    </div>
  );
}
