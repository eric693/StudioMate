import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, MessageCircle } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import { Member } from '../types';
import { addDays, localDay, passText } from '../lib/format';
import MemberForm from './MemberForm';

export default function Members() {
  const [list, setList] = useState<Member[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | ''>('ACTIVE');
  const [adding, setAdding] = useState(false);
  const [pass, setPass] = useState<'' | 'HAS' | 'NONE' | 'EXPIRING' | 'LOW' | 'FROZEN'>('');
  const [line, setLine] = useState<'' | 'BOUND' | 'UNBOUND'>('');
  const [rule, setRule] = useState({ expiryRemindDays: 7, lowCreditThreshold: 2 });
  useEffect(() => { api.get('/studio').then((r) => setRule(r.data)).catch(() => {}); }, []);
  const load = () => api.get('/members', { params: { q: q || undefined, status: status || undefined } }).then((r) => setList(r.data));
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const soon = addDays(localDay(), Math.max(rule.expiryRemindDays, 7));
  const shown = list.filter((m) => {
    const ps = m.activePasses ?? [];
    if (line && (line === 'BOUND') !== m.lineBound) return false;
    switch (pass) {
      case 'HAS': return ps.length > 0;
      case 'NONE': return ps.length === 0;
      case 'EXPIRING': return ps.some((p) => p.endDate.slice(0, 10) <= soon);
      case 'LOW': return ps.some((p) => p.kind !== 'PERIOD' && (p.creditsLeft ?? 0) <= Math.max(rule.lowCreditThreshold, 2));
      case 'FROZEN': return ps.some((p) => p.status === 'FROZEN');
      default: return true;
    }
  });

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div><h1 className="text-xl font-bold text-gray-800">會員</h1><p className="text-sm text-gray-400">{shown.length === list.length ? `共 ${list.length} 位` : `符合 ${shown.length} / ${list.length} 位`}</p></div>
        <div><button className="btn-primary flex items-center gap-1" onClick={() => setAdding(true)}><Plus className="w-4 h-4" />新增會員</button></div>
      </div>
      <HowTo module="members" />
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2 input flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 text-gray-400" />
          <input className="flex-1 outline-none bg-transparent text-sm" placeholder="搜尋姓名或電話" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ACTIVE">使用中</option><option value="INACTIVE">已停用</option><option value="">全部會員</option>
        </select>
        <select className="input w-auto" value={pass} onChange={(e) => setPass(e.target.value as typeof pass)} aria-label="方案">
          <option value="">全部方案狀況</option><option value="HAS">有有效方案</option><option value="NONE">沒有方案</option>
          <option value="EXPIRING">即將到期</option><option value="LOW">堂數快用完</option><option value="FROZEN">凍結中</option>
        </select>
        <select className="input w-auto" value={line} onChange={(e) => setLine(e.target.value as typeof line)} aria-label="LINE">
          <option value="">LINE 全部</option><option value="BOUND">已綁定 LINE</option><option value="UNBOUND">未綁定 LINE</option>
        </select>
      </div>
      <div className="card p-0 overflow-hidden">
        {shown.length === 0 ? <p className="text-sm text-gray-400 p-4">沒有符合的會員。</p> : (
          <div className="divide-y divide-gray-50">
            {shown.map((m) => (
              <Link key={m.id} to={`/members/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-semibold flex-shrink-0">{m.name.charAt(0)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                    {m.name}{m.lineBound && <MessageCircle className="w-3.5 h-3.5 text-green-500" aria-label="已綁定 LINE" />}
                    {m.status === 'INACTIVE' && <span className="text-[11px] bg-gray-100 text-gray-400 px-1.5 rounded-full">停用</span>}
                  </div>
                  <div className="text-xs text-gray-400">{m.phone}</div>
                  <div className="sm:hidden text-xs text-gray-500 truncate">{m.activePasses?.length ? `${m.activePasses[0].planName}：${passText(m.activePasses[0])}` : <span className="text-gray-300">沒有有效方案</span>}</div>
                </div>
                <div className="hidden sm:block text-xs text-right text-gray-500 max-w-[45%]">
                  {m.activePasses?.length ? m.activePasses.slice(0, 2).map((p) => <div key={p.id} className="truncate">{p.planName}：{passText(p)}</div>)
                    : <span className="text-gray-300">沒有有效方案</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {adding && <MemberForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}
