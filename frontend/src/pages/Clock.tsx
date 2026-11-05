import { useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import api from '../api/client';
import { dateTime, hm, hours } from '../lib/format';

interface ClockData {
  open: { id: string; clockIn: string } | null;
  shifts: { id: string; startTime: string; endTime: string; note: string | null }[];
  recent: { id: string; clockIn: string; clockOut: string | null }[];
}

/** 員工自己打卡（每個帳號都能用，不需要模組權限） */
export default function Clock() {
  const [d, setD] = useState<ClockData | null>(null);
  const [now, setNow] = useState(new Date());
  const load = () => api.get('/me/clock').then((r) => setD(r.data));
  useEffect(() => { load(); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  async function punch() { await api.post(d?.open ? '/me/clock/out' : '/me/clock/in'); load(); }
  if (!d) return <div className="text-sm text-gray-400">載入中…</div>;
  return (
    <div className="max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">打卡</h1>
      <div className="card text-center py-8 space-y-3">
        <div className="text-5xl font-bold text-gray-800 tabular-nums">{hm(now)}<span className="text-2xl text-gray-400">:{String(now.getSeconds()).padStart(2, '0')}</span></div>
        <div className="text-sm text-gray-500">
          {d.shifts.length ? `今天班表：${d.shifts.map((s) => `${s.startTime}–${s.endTime}${s.note ? `（${s.note}）` : ''}`).join('、')}` : '今天沒有排班'}
        </div>
        {d.open && <div className="text-sm text-green-600">{hm(d.open.clockIn)} 上班，已工作 {hours((now.getTime() - new Date(d.open.clockIn).getTime()) / 3600e3)}</div>}
        <button className={`mx-auto w-40 h-40 rounded-full text-white text-lg font-semibold flex flex-col items-center justify-center gap-1 shadow-lg ${d.open ? 'bg-orange-500 hover:bg-orange-600' : 'bg-brand hover:bg-brand-dark'}`} onClick={punch}>
          {d.open ? <LogOut className="w-8 h-8" /> : <LogIn className="w-8 h-8" />}
          {d.open ? '下班打卡' : '上班打卡'}
        </button>
      </div>
      <div className="card">
        <h2 className="text-sm font-medium text-gray-700 mb-2">最近打卡</h2>
        {d.recent.length === 0 ? <p className="text-sm text-gray-400">還沒有打卡紀錄。</p> : d.recent.map((c) => (
          <div key={c.id} className="flex justify-between text-sm py-1 text-gray-600">
            <span>{dateTime(c.clockIn)}</span>
            <span>{c.clockOut ? `~ ${hm(c.clockOut)}（${hours((new Date(c.clockOut).getTime() - new Date(c.clockIn).getTime()) / 3600e3)}）` : '上班中'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
