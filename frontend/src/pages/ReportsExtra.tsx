// 營收報表的新頁籤：營運分析、預收款（履約保障）、退費紀錄
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { PAY_METHOD, PLAN_KIND, TRUST_TYPE, WEEKDAYS, dateStr, dateTime, money } from '../lib/format';

interface Rank { name: string; color?: string; sessions: number; heads: number; fill: number; avgHeads: number }
interface InsightData {
  renewal: { month: string; ended: number; renewed: number; churned: number; rate: number | null }[];
  heat: number[][]; classTypes: Rank[]; coaches: Rank[];
  members: { activePass: number; recentlyActive: number; atRisk: number };
  atRisk: { id: string; name: string; phone: string; lastAttended: string | null }[];
}

export function Insights() {
  const [d, setD] = useState<InsightData | null>(null);
  useEffect(() => { api.get('/reports/insights').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="text-sm text-gray-400">分析中…</div>;
  // 熱門時段只顯示有課的時段（例如 06–22 點）
  const hoursUsed = d.heat[0].map((_, h) => h).filter((h) => d.heat.some((row) => row[h] > 0));
  const hFrom = hoursUsed.length ? Math.min(...hoursUsed) : 7, hTo = hoursUsed.length ? Math.max(...hoursUsed) : 21;
  const cols = Array.from({ length: hTo - hFrom + 1 }, (_, i) => hFrom + i);
  const max = Math.max(1, ...d.heat.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="有效方案會員" value={d.members.activePass} />
        <Stat label="近 30 天有上課" value={d.members.recentlyActive} />
        <Stat label="流失風險（有方案但 30 天沒來）" value={d.members.atRisk} warn={d.members.atRisk > 0} />
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-1">續約率</h2>
        <p className="text-xs text-gray-400 mb-3">當月到期的會員中，到期前後 30 天內再購買的比例；流失＝到期後 30 天都沒有再購買</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead><tr className="text-xs text-gray-400 text-left"><th className="py-1 font-normal">月份</th><th className="font-normal text-right">到期人數</th><th className="font-normal text-right">續約</th><th className="font-normal text-right">流失</th><th className="font-normal text-right">續約率</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {d.renewal.map((r) => (
                <tr key={r.month}>
                  <td className="py-1.5 text-gray-600">{r.month}</td><td className="text-right">{r.ended}</td><td className="text-right text-green-600">{r.renewed}</td><td className="text-right text-red-500">{r.churned}</td>
                  <td className="text-right">{r.rate == null ? '—' : <span className="inline-flex items-center gap-2"><span className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden inline-block"><span className="block h-full bg-brand" style={{ width: `${r.rate}%` }} /></span>{r.rate}%</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-1">熱門時段</h2>
        <p className="text-xs text-gray-400 mb-3">近 90 天出席人次，顏色越深越熱門，可用來調整開課時段</p>
        <div className="overflow-x-auto">
          <table className="text-[11px] border-separate" style={{ borderSpacing: 2 }}>
            <thead><tr><th />{cols.map((h) => <th key={h} className="font-normal text-gray-400 w-8">{h}</th>)}</tr></thead>
            <tbody>
              {order.map((w) => (
                <tr key={w}>
                  <td className="pr-2 text-gray-500 whitespace-nowrap">週{WEEKDAYS[w]}</td>
                  {cols.map((h) => {
                    const v = d.heat[w][h];
                    return <td key={h} title={`週${WEEKDAYS[w]} ${h}:00　${v} 人次`} className="w-8 h-7 rounded text-center tabular-nums" style={{ background: v ? `rgba(217, 87, 59, ${0.12 + 0.88 * (v / max)})` : "#f3f4f6", color: v / max > 0.55 ? "#fff" : "#4b5563" }}>{v || ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <RankCard title="熱門課程（近 90 天）" rows={d.classTypes} />
        <RankCard title="教練排行（近 90 天）" rows={d.coaches} />
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-700 mb-1 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-500" />流失風險名單</h2>
        <p className="text-xs text-gray-400 mb-2">有有效方案、但超過 30 天沒來上課的會員。可以到「行銷 → 群發訊息」選「久未上課」關心，或開啟「自動行銷 → 久未到訪喚回」。</p>
        {d.atRisk.length === 0 ? <p className="text-sm text-gray-400">目前沒有。</p> : (
          <div className="divide-y divide-gray-50">
            {d.atRisk.map((m) => <Link key={m.id} to={`/members/${m.id}`} className="flex justify-between py-1.5 text-sm hover:text-brand"><span>{m.name}<span className="text-gray-400 ml-2">{m.phone}</span></span><span className="text-xs text-gray-400">{m.lastAttended ? `最後上課 ${dateStr(m.lastAttended)}` : '還沒上過課'}</span></Link>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return <div className="card"><div className="text-xs text-gray-400">{label}</div><div className={`text-2xl font-bold mt-1 tabular-nums ${warn ? 'text-amber-600' : 'text-gray-800'}`}>{value}</div></div>;
}

function RankCard({ title, rows }: { title: string; rows: Rank[] }) {
  const max = Math.max(1, ...rows.map((r) => r.heads));
  return (
    <div className="card">
      <h2 className="font-semibold text-gray-700 mb-3">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-gray-400">還沒有上課資料。</p> : (
        <div className="space-y-2">
          {rows.slice(0, 10).map((r) => (
            <div key={r.name} className="text-sm">
              <div className="flex justify-between"><span className="text-gray-700">{r.name}</span><span className="text-xs text-gray-500 tabular-nums">{r.heads} 人次・{r.sessions} 堂・平均 {r.avgHeads} 人・滿班率 {r.fill}%</span></div>
              <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className="h-full rounded-full" style={{ width: `${(r.heads / max) * 100}%`, background: r.color ?? "#d9573b" }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DeferredData {
  today: string; total: number; count: number; monthCollected: number; monthRefunded: number;
  trust: { type: string | null; bank: string | null; note: string | null };
  rows: { id: string; member: { id: string; name: string; phone: string }; planName: string; kind: string; paidAt: string; endDate: string; base: number; used: number; remaining: number; creditsLeft: number | null }[];
}

/** 預收款：已收款但還沒提供服務的金額，信託或履約保證的申報基礎 */
export function Deferred() {
  const [d, setD] = useState<DeferredData | null>(null);
  useEffect(() => { api.get('/reports/deferred').then((r) => setD(r.data)); }, []);
  if (!d) return <div className="text-sm text-gray-400">計算中…</div>;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-6 items-center">
        <div><div className="text-xs text-gray-400">尚未履約的預收款（{d.today}）</div><div className="text-3xl font-bold text-gray-800 tabular-nums">{money(d.total)}</div><div className="text-xs text-gray-400">{d.count} 張有效方案</div></div>
        <div className="text-sm text-gray-600 space-y-0.5"><div>本月收款 {money(d.monthCollected)}</div><div>本月退費 {money(d.monthRefunded)}</div></div>
        <div className={`ml-auto rounded-xl px-3 py-2 text-sm flex items-start gap-2 ${d.trust.type ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          <ShieldCheck className="w-4 h-4 mt-0.5" />
          {d.trust.type ? <span>{d.trust.bank}・{TRUST_TYPE[d.trust.type]}{d.trust.note ? `・${d.trust.note}` : ''}</span> : <span>尚未設定履約保障。到「教室設定 → 退費與履約保障」填寫合作銀行，會顯示在購買頁與合約上。</span>}
        </div>
      </div>
      <p className="text-xs text-gray-400">剩餘價值＝售價 × 未使用比例（堂數卡看剩餘堂數，期限卡看剩餘天數，凍結期間不計）。已預約未上的課視為未使用。</p>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem] tabular-nums">
          <thead><tr className="text-xs text-gray-400 text-left border-b border-gray-100"><th className="px-4 py-2 font-normal">會員</th><th className="font-normal">方案</th><th className="font-normal">到期</th><th className="font-normal text-right">金額</th><th className="font-normal text-right">已使用</th><th className="font-normal text-right pr-4">剩餘價值</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {d.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-1.5"><Link to={`/members/${r.member.id}`} className="text-gray-800 hover:text-brand">{r.member.name}</Link></td>
                <td className="text-gray-600">{r.planName}<span className="text-xs text-gray-400 ml-1">{PLAN_KIND[r.kind]}{r.kind !== 'PERIOD' ? `・剩 ${r.creditsLeft} 堂` : ''}</span></td>
                <td className="text-gray-500">{dateStr(r.endDate)}</td>
                <td className="text-right">{money(r.base)}</td>
                <td className="text-right text-gray-500">{money(r.used)}</td>
                <td className="text-right pr-4 font-medium">{money(r.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.rows.length === 0 && <p className="text-sm text-gray-400 p-4">目前沒有尚未履約的預收款。</p>}
      </div>
    </div>
  );
}

interface RefundRow { id: string; amount: number; usedValue: number; fee: number; method: string; reason: string | null; allowanceNo: string | null; invoiceAction: string | null; createdAt: string; member: { id: string; name: string; phone: string }; membership: { planName: string; price: number } }

export function Refunds() {
  const [list, setList] = useState<RefundRow[] | null>(null);
  useEffect(() => { api.get('/refunds').then((r) => setList(r.data)); }, []);
  const total = (list ?? []).reduce((a, r) => a + r.amount, 0);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">退費在會員頁的方案上辦理。{list?.length ? `共 ${list.length} 筆，合計 ${money(total)}` : ''}</p>
      <div className="card p-0 overflow-hidden divide-y divide-gray-50">
        {list?.length === 0 && <p className="text-sm text-gray-400 p-4">還沒有退費紀錄。</p>}
        {list?.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <div className="flex-1 min-w-[14rem]">
              <div><Link to={`/members/${r.member.id}`} className="text-gray-800 font-medium hover:text-brand">{r.member.name}</Link><span className="text-gray-500 ml-2">{r.membership.planName}（{money(r.membership.price)}）</span></div>
              <div className="text-xs text-gray-400">{dateTime(r.createdAt)}・{PAY_METHOD[r.method]}退款・已使用 {money(r.usedValue)}・手續費 {money(r.fee)}{r.reason ? `・${r.reason}` : ''}{r.invoiceAction === 'VOID' ? '・發票已作廢' : r.invoiceAction === 'ALLOWANCE' ? `・折讓單 ${r.allowanceNo}` : ''}</div>
            </div>
            <span className="font-semibold text-red-500 tabular-nums">-{money(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
