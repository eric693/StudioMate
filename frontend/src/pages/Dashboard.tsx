import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, Wallet, CalendarCheck, Clock, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import { Session } from '../types';
import { dateStr, hm, money, shortDay } from '../lib/format';

interface PassRow { id: string; planName: string; kind: string; creditsLeft: number | null; endDate: string; member: { id: string; name: string; phone: string } }
interface DashboardData {
  studioName: string; today: string; sessions: Session[];
  stats: { activeMembers: number; monthRevenue: number; monthSales: number; attendanceRate30d: number | null; bookings30d: number };
  expiring: PassRow[]; lowCredits: PassRow[];
}

export default function Dashboard() {
  const [d, setD] = useState<DashboardData | null>(null);
  const navigate = useNavigate();
  useEffect(() => { api.get('/dashboard').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="text-gray-400 text-sm">載入中…</div>;

  const setupNeeded = d.sessions.length === 0 && d.stats.activeMembers === 0;
  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{d.studioName}</h1>
          <p className="text-sm text-gray-400">{shortDay(d.today)}・今天有 {d.sessions.filter((s) => s.status === 'SCHEDULED').length} 堂課</p>
        </div>
      </div>
      <HowTo module="dashboard" />

      {setupNeeded && (
        <div className="card border border-brand/20">
          <div className="font-semibold text-gray-700 mb-2">開始使用的四個步驟</div>
          <ol className="text-sm text-gray-600 space-y-1.5 list-decimal pl-5">
            <li><Link to="/catalog" className="text-brand hover:underline">建立課程類型與教練</Link>（例如：哈達瑜珈、拳擊有氧）</li>
            <li><Link to="/catalog" className="text-brand hover:underline">建立販售的方案</Link>（例如：10 堂卡、月卡、單堂）</li>
            <li><Link to="/templates" className="text-brand hover:underline">設定每週固定課表</Link>，系統會自動產生未來的課程</li>
            <li><Link to="/members" className="text-brand hover:underline">新增會員並售卡</Link>，就可以開始預約與點名</li>
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Users} label="有效會員" value={`${d.stats.activeMembers} 人`} />
        <Stat icon={Wallet} label="本月營收" value={money(d.stats.monthRevenue)} sub={`${d.stats.monthSales} 筆售卡`} />
        <Stat icon={CalendarCheck} label="近 30 天出席率" value={d.stats.attendanceRate30d === null ? '—' : `${d.stats.attendanceRate30d}%`} sub={`${d.stats.bookings30d} 人次`} />
        <Stat icon={AlertTriangle} label="待續約" value={`${new Set([...d.expiring, ...d.lowCredits].map((x) => x.member.id)).size} 人`} sub="即將到期或堂數快用完" />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-700">今天的課</h2>
          <Link to="/schedule" className="text-xs text-brand hover:underline">完整課表</Link>
        </div>
        {d.sessions.length === 0 ? <p className="text-sm text-gray-400">今天沒有課程。</p> : (
          <div className="divide-y divide-gray-50">
            {d.sessions.map((s) => {
              const full = s.booked >= s.capacity;
              return (
                <button key={s.id} onClick={() => navigate(`/schedule?session=${s.id}`)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2">
                  <span className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ background: s.status === 'CANCELLED' ? '#d1d5db' : s.classType.color }} />
                  <div className="w-14 text-sm font-mono text-gray-600">{hm(s.startsAt)}</div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${s.status === 'CANCELLED' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{s.classType.name}</div>
                    <div className="text-xs text-gray-400 truncate">{s.coach?.name ?? '未指定教練'}{s.room ? `・${s.room}` : ''}</div>
                  </div>
                  {s.status === 'CANCELLED' ? <span className="text-xs text-gray-400">已取消</span> : (
                    <div className="text-right">
                      <div className={`text-sm font-semibold ${full ? 'text-brand' : 'text-gray-700'}`}>{s.booked}/{s.capacity}</div>
                      <div className="text-xs text-gray-400">{s.waitlist ? `候補 ${s.waitlist}` : full ? '額滿' : `出席 ${s.attended}`}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <PassList title="即將到期" icon={Clock} rows={d.expiring} empty="近期沒有即將到期的方案" render={(p) => `${dateStr(p.endDate)} 到期${p.kind === 'PERIOD' ? '' : `・剩 ${p.creditsLeft} 堂`}`} />
        <PassList title="堂數快用完" icon={AlertTriangle} rows={d.lowCredits} empty="沒有堂數偏低的會員" render={(p) => `剩 ${p.creditsLeft} 堂・${dateStr(p.endDate)} 到期`} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className="text-lg font-bold text-gray-800">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function PassList({ title, icon: Icon, rows, empty, render }: { title: string; icon: React.ElementType; rows: PassRow[]; empty: string; render: (p: PassRow) => string }) {
  return (
    <div className="card">
      <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-1.5"><Icon className="w-4 h-4 text-brand" />{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-gray-400">{empty}</p> : (
        <div className="divide-y divide-gray-50">
          {rows.map((p) => (
            <Link key={p.id} to={`/members/${p.member.id}`} className="flex items-center justify-between py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{p.member.name}</div>
                <div className="text-xs text-gray-400 truncate">{p.planName}・{p.member.phone}</div>
              </div>
              <div className="text-xs text-gray-500 text-right flex-shrink-0 ml-2">{render(p)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
