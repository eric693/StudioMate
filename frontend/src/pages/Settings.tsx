import { useEffect, useState } from 'react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import SearchBox from '../components/SearchBox';
import { Field } from '../components/Modal';
import { Studio } from '../types';
import { dateTime, setTimeZone } from '../lib/format';

interface Log { id: string; kind: string; channel: string; message: string; memberName: string; createdAt: string }
const KIND: Record<string, string> = { CLASS: '上課提醒', EXPIRY: '到期提醒', LOW_CREDIT: '堂數提醒', PROMOTED: '候補遞補', SESSION_CANCELLED: '停課通知' };

export default function Settings() {
  const [s, setS] = useState<Studio | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [saved, setSaved] = useState(false);
  const [lf, setLf] = useState({ q: '', kind: '', channel: '' });
  useEffect(() => { api.get('/studio').then((r) => setS(r.data)); }, []);
  useEffect(() => {
    const t = setTimeout(() => api.get('/studio/notifications', { params: lf }).then((r) => setLogs(r.data)), 250);
    return () => clearTimeout(t);
  }, [lf]);
  if (!s) return <div className="text-gray-400 text-sm">載入中…</div>;

  const set = <K extends keyof Studio>(k: K, v: Studio[K]) => { setS({ ...s, [k]: v }); setSaved(false); };
  const num = (k: keyof Studio) => ({ type: 'number', className: 'input', value: String(s[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, +e.target.value as never) });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const keys: (keyof Omit<Studio, 'lineEnabled'>)[] = ['name', 'phone', 'address', 'timezone', 'bookingWindowDays', 'cancelDeadlineHours', 'lateCancelForfeit', 'waitlistEnabled', 'autoAttend', 'remindBeforeHours', 'expiryRemindDays', 'lowCreditThreshold'];
    const r = await api.put('/studio', Object.fromEntries(keys.map((k) => [k, k === 'phone' || k === 'address' ? (s![k] || null) : s![k]])));
    setTimeZone(r.data.timezone);
    setSaved(true);
  }
  const Toggle = ({ k, label, hint }: { k: 'lateCancelForfeit' | 'waitlistEnabled' | 'autoAttend'; label: string; hint: string }) => (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={s[k]} onChange={(e) => set(k, e.target.checked)} />
      <span><span className="text-sm text-gray-700">{label}</span><span className="block text-xs text-gray-400">{hint}</span></span>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="page-header"><div><h1 className="text-xl font-bold text-gray-800">教室設定</h1></div></div>
      <HowTo module="settings" />
      <form onSubmit={save} className="space-y-4">
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">教室資料</h2>
          <Field label="教室名稱"><input className="input" value={s.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="電話"><input className="input" value={s.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="時區"><select className="input" value={s.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {['Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Kuala_Lumpur'].map((z) => <option key={z}>{z}</option>)}
            </select></Field>
          </div>
          <Field label="地址"><input className="input" value={s.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">預約規則</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="可預約幾天內的課"><input {...num('bookingWindowDays')} min={1} max={90} /></Field>
            <Field label="開課前幾小時截止取消"><input {...num('cancelDeadlineHours')} min={0} max={168} /></Field>
          </div>
          <div className="divide-y divide-gray-50">
            <Toggle k="lateCancelForfeit" label="晚取消扣堂" hint="超過取消截止時間才取消，堂數不退回（櫃檯仍可勾選例外退堂）" />
            <Toggle k="waitlistEnabled" label="開放候補" hint="額滿後可排候補，有人取消時依順序自動遞補並通知" />
            <Toggle k="autoAttend" label="課程結束自動視為出席" hint="不點名的教室請開啟；關閉時未點名的預約會記為「未到」" />
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">LINE 提醒</h2>
          {!s.lineEnabled && <p className="text-xs bg-amber-50 text-amber-700 rounded-lg px-2 py-1.5">尚未設定 LINE 官方帳號，目前為沙盒模式：訊息只會記錄在下方，不會真的送出。</p>}
          <div className="grid grid-cols-3 gap-3">
            <Field label="上課前（小時）" hint="0＝不提醒"><input {...num('remindBeforeHours')} min={0} max={72} /></Field>
            <Field label="到期前（天）" hint="0＝不提醒"><input {...num('expiryRemindDays')} min={0} max={60} /></Field>
            <Field label="剩幾堂時提醒" hint="0＝不提醒"><input {...num('lowCreditThreshold')} min={0} max={50} /></Field>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary">儲存設定</button>
          {saved && <span className="text-sm text-green-600">已儲存</span>}
        </div>
      </form>
      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-3">通知紀錄</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          <SearchBox value={lf.q} onChange={(v) => setLf({ ...lf, q: v })} placeholder="搜尋會員或訊息內容" />
          <select className="input w-auto text-sm" value={lf.kind} onChange={(e) => setLf({ ...lf, kind: e.target.value })} aria-label="通知類型">
            <option value="">全部類型</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input w-auto text-sm" value={lf.channel} onChange={(e) => setLf({ ...lf, channel: e.target.value })} aria-label="送出狀態">
            <option value="">全部</option><option value="LINE">已送出</option><option value="SANDBOX">沙盒</option>
          </select>
        </div>
        {logs.length === 0 ? <p className="text-sm text-gray-400">{Object.values(lf).some(Boolean) ? '沒有符合條件的通知。' : '還沒有通知。'}</p> : (
          <div className="divide-y divide-gray-50">
            {logs.map((l) => (
              <div key={l.id} className="py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-gray-100 text-gray-500 px-1.5 rounded">{KIND[l.kind] ?? l.kind}</span>
                  <span className="text-gray-700">{l.memberName}</span>
                  <span className={l.channel === 'LINE' ? 'text-green-600' : 'text-gray-400'}>{l.channel === 'LINE' ? '已送出' : '沙盒'}</span>
                  <span className="ml-auto text-gray-400">{dateTime(l.createdAt)}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{l.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
