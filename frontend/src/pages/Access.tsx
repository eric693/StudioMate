import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, ScanLine, Copy, RefreshCw, Trash2 } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import MemberPicker, { PickedMember, Tabs } from '../components/MemberPicker';
import { dateTime } from '../lib/format';

interface ScanResult { allowed: boolean; reason: string; member?: { id: string; name: string }; checkedIn?: string | null }
interface Log { id: string; allowed: boolean; reason: string; createdAt: string; member: { id: string; name: string } | null; device: { name: string } | null }
interface Device { id: string; name: string; token: string; active: boolean; lastSeenAt: string | null }

export default function Access() {
  const [tab, setTab] = useState<'scan' | 'logs' | 'devices'>('scan');
  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-800">門禁與入場</h1>
          <p className="text-sm text-gray-400">會員出示手機上的入場 QR code，櫃檯掃碼或閘門自動判斷是否放行</p>
        </div>
      </div>
      <HowTo module="access" />
      <Tabs tabs={[['scan', '櫃檯掃碼'], ['logs', '入場紀錄'], ['devices', '閘門裝置']]} value={tab} onChange={setTab} />
      {tab === 'scan' && <Scan />}
      {tab === 'logs' && <Logs />}
      {tab === 'devices' && <Devices />}
    </div>
  );
}

/** USB／藍牙掃碼器會像鍵盤一樣輸入 QR code 內容再按 Enter，所以輸入框一直保持焦點 */
function Scan() {
  const [code, setCode] = useState('');
  const [member, setMember] = useState<PickedMember | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [result]);
  useEffect(() => { if (!result) return; const t = setTimeout(() => setResult(null), 6000); return () => clearTimeout(t); }, [result]);
  async function check(body: { code?: string; memberId?: string }) {
    const r = await api.post('/access/scan', body);
    setResult(r.data); setCode(''); setMember(null);
  }
  return (
    <div className="grid md:grid-cols-2 gap-4 items-start">
      <div className="card space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) check({ code: code.trim() }); }}>
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><ScanLine className="w-4 h-4" />掃描會員入場 QR code</label>
          <input ref={input} className="input mt-1 font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="把游標停在這裡，用掃碼器掃描" autoComplete="off" />
        </form>
        <div className="text-xs text-gray-400">會員忘記帶手機時，也可以直接選擇會員判斷：</div>
        <div className="flex gap-2">
          <div className="flex-1"><MemberPicker value={member} onChange={setMember} /></div>
          <button className="btn-secondary" disabled={!member} onClick={() => member && check({ memberId: member.id })}>確認</button>
        </div>
      </div>
      <div className={`card min-h-[12rem] flex flex-col items-center justify-center text-center ${result ? (result.allowed ? 'bg-green-50' : 'bg-red-50') : ''}`} aria-live="polite">
        {!result ? <p className="text-sm text-gray-400">等待掃碼…</p> : (
          <>
            {result.allowed ? <CheckCircle2 className="w-16 h-16 text-green-500" /> : <XCircle className="w-16 h-16 text-red-500" />}
            <div className={`text-2xl font-bold mt-2 ${result.allowed ? 'text-green-700' : 'text-red-600'}`}>{result.allowed ? '歡迎入場' : '無法入場'}</div>
            {result.member && <Link to={`/members/${result.member.id}`} className="text-lg text-gray-800 mt-1 hover:text-brand">{result.member.name}</Link>}
            <div className="text-sm text-gray-600 mt-1">{result.reason}</div>
            {result.checkedIn && <div className="text-sm text-green-700 mt-1">已自動簽到：{result.checkedIn}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function Logs() {
  const [allowed, setAllowed] = useState('');
  const [list, setList] = useState<Log[] | null>(null);
  useEffect(() => { api.get('/access/logs', { params: { allowed } }).then((r) => setList(r.data)); }, [allowed]);
  return (
    <div className="space-y-3">
      <select className="input w-auto text-sm" value={allowed} onChange={(e) => setAllowed(e.target.value)} aria-label="結果">
        <option value="">全部</option><option value="yes">放行</option><option value="no">拒絕</option>
      </select>
      <div className="card p-0 overflow-hidden">
        {list?.length === 0 && <p className="text-sm text-gray-400 p-4">還沒有入場紀錄。</p>}
        <div className="divide-y divide-gray-50">
          {list?.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              {l.allowed ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
              <span className="w-28 flex-shrink-0 text-gray-500 tabular-nums">{dateTime(l.createdAt)}</span>
              <span className="flex-1 min-w-0 truncate">{l.member ? <Link to={`/members/${l.member.id}`} className="text-gray-800 hover:text-brand">{l.member.name}</Link> : <span className="text-gray-400">未知</span>}<span className="text-gray-400 ml-2">{l.reason}</span></span>
              <span className="text-xs text-gray-400">{l.device?.name ?? '櫃檯'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Devices() {
  const [list, setList] = useState<Device[]>([]);
  const [name, setName] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const load = () => api.get('/access/devices').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  async function add(e: React.FormEvent) { e.preventDefault(); const r = await api.post('/access/devices', { name }); setName(''); setShown(r.data.id); load(); }
  async function rotate(d: Device) { if (!confirm(`重新產生「${d.name}」的金鑰？舊金鑰立即失效，需更新裝置設定。`)) return; await api.put(`/access/devices/${d.id}`, { rotate: true }); setShown(d.id); load(); }
  async function toggle(d: Device) { await api.put(`/access/devices/${d.id}`, { active: !d.active }); load(); }
  async function remove(d: Device) { if (!confirm(`刪除「${d.name}」？`)) return; await api.delete(`/access/devices/${d.id}`); load(); }
  return (
    <div className="space-y-3">
      <div className="card text-sm text-gray-600 space-y-2">
        <p>閘門、電子鎖或門口的平板掃碼後，呼叫下面的網址判斷是否開門。每台裝置有自己的金鑰，遺失或外流時可單獨停用。</p>
        <pre className="bg-gray-50 rounded-xl p-3 text-xs overflow-x-auto">{`POST ${location.origin}/api/access/check
X-Device-Token: <裝置金鑰>
Content-Type: application/json

{ "code": "<掃到的 QR code 內容>" }

→ { "allowed": true, "reason": "10 堂卡・剩 6 堂・2027-01-31 到期", "member": { "name": "王小明" } }`}</pre>
        <p className="text-xs text-gray-400">QR code 每 30 秒更新，截圖轉傳約 1 分鐘後失效。allowed 為 true 時開門即可。</p>
      </div>
      <form onSubmit={add} className="flex gap-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="裝置名稱，例如：大門閘門" required /><button className="btn-primary">新增裝置</button></form>
      <div className="card p-0 overflow-hidden divide-y divide-gray-50">
        {list.length === 0 && <p className="text-sm text-gray-400 p-4">還沒有裝置。只用櫃檯掃碼的話不需要新增。</p>}
        {list.map((d) => (
          <div key={d.id} className="px-4 py-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <span className={`font-medium ${d.active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{d.name}</span>
              <span className="text-xs text-gray-400">{d.lastSeenAt ? `最後連線 ${dateTime(d.lastSeenAt)}` : '尚未連線'}</span>
              <div className="ml-auto flex gap-1">
                <button className="text-xs text-gray-500 px-2" onClick={() => setShown(shown === d.id ? null : d.id)}>{shown === d.id ? '隱藏金鑰' : '顯示金鑰'}</button>
                <button className="text-xs text-gray-500 px-2" onClick={() => toggle(d)}>{d.active ? '停用' : '啟用'}</button>
                <button className="p-1 rounded hover:bg-gray-50" title="重新產生金鑰" aria-label="重新產生金鑰" onClick={() => rotate(d)}><RefreshCw className="w-4 h-4 text-gray-400" /></button>
                <button className="p-1 rounded hover:bg-gray-50" title="刪除" aria-label="刪除" onClick={() => remove(d)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
              </div>
            </div>
            {shown === d.id && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1">
                <code className="text-xs break-all flex-1">{d.token}</code>
                <button aria-label="複製金鑰" onClick={() => navigator.clipboard?.writeText(d.token)}><Copy className="w-4 h-4 text-gray-400" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
