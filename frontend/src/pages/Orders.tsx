import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Trash2 } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import SearchBox from '../components/SearchBox';
import { Order } from '../types';
import { ORDER_STATUS, dateTime, money } from '../lib/format';

export default function Orders() {
  const [list, setList] = useState<Order[] | null>(null);
  const [f, setF] = useState({ q: '', status: 'PENDING', method: '' });
  const [msg, setMsg] = useState('');
  const load = () => api.get('/orders', { params: f }).then((r) => { setList(r.data); window.dispatchEvent(new Event('orders-changed')); });
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(o: Order) {
    if (!confirm(`確認已收到 ${o.member?.name} 的轉帳 ${money(o.amount)}（帳號後五碼 ${o.transferLast5}）？\n通過後會自動把「${o.plan.name}」加到會員帳戶。`)) return;
    await api.post(`/orders/${o.id}/approve`); setMsg(`已通過，${o.member?.name} 的「${o.plan.name}」已開通`); load();
  }
  async function reject(o: Order) {
    const reason = prompt('退回原因（會通知會員）：', '查無入帳紀錄');
    if (reason === null) return;
    await api.post(`/orders/${o.id}/reject`, { reason }); setMsg('已退回並通知會員'); load();
  }
  async function remove(o: Order) {
    if (!confirm(`刪除訂單 ${o.tradeNo}？`)) return;
    await api.delete(`/orders/${o.id}`); load();
  }
  const waiting = (list ?? []).filter((o) => o.status === 'PENDING' && o.method === 'TRANSFER' && o.transferLast5).length;

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-800">線上訂單</h1>
          <p className="text-sm text-gray-400">{list ? `${list.length} 筆${waiting ? `・${waiting} 筆轉帳待審核` : ''}` : '載入中…'}</p>
        </div>
      </div>
      <HowTo module="orders" />
      {msg && <div className="text-sm bg-green-50 text-green-700 rounded-xl px-3 py-2">{msg}</div>}
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={f.q} onChange={(v) => setF({ ...f, q: v })} placeholder="搜尋會員、電話、方案、訂單編號、後五碼" />
        <select className="input w-auto text-sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="狀態">
          <option value="">全部狀態</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto text-sm" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} aria-label="付款方式">
          <option value="">全部付款方式</option><option value="ONLINE">線上刷卡</option><option value="TRANSFER">銀行轉帳</option>
        </select>
      </div>
      <div className="card p-0 overflow-hidden">
        {list && list.length === 0 ? <p className="text-sm text-gray-400 p-4">沒有符合條件的訂單。</p> : (
          <div className="divide-y divide-gray-50">
            {(list ?? []).map((o) => {
              const canReview = o.status === 'PENDING' && o.method === 'TRANSFER';
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <div className="flex-1 min-w-[14rem]">
                    <div className="text-sm text-gray-800">
                      {o.member && <Link to={`/members/${o.member.id}`} className="font-medium hover:text-brand">{o.member.name}</Link>}
                      <span className="text-gray-500 ml-2">{o.plan.name}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full ml-2 ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {dateTime(o.createdAt)}・{o.method === 'ONLINE' ? '線上刷卡' : '銀行轉帳'}・{o.tradeNo}
                      {o.coupon && `・折價券 ${o.coupon.code}（-${o.discount}）`}
                    </div>
                    {o.method === 'TRANSFER' && o.status === 'PENDING' && (
                      <div className={`text-xs mt-0.5 ${o.transferLast5 ? 'text-amber-700' : 'text-gray-400'}`}>
                        {o.transferLast5 ? `會員已回報：帳號後五碼 ${o.transferLast5}${o.transferAt ? `，${dateTime(o.transferAt).split('）')[0]}）轉帳` : ''}` : '等待會員回報轉帳資料'}
                      </div>
                    )}
                    {o.rejectReason && <div className="text-xs text-red-500 mt-0.5">{o.rejectReason}</div>}
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{money(o.amount)}</span>
                  <div className="flex gap-1">
                    {canReview && o.transferLast5 && <button className="btn-primary text-xs py-1 px-2 flex items-center gap-1" onClick={() => approve(o)}><Check className="w-3.5 h-3.5" />通過</button>}
                    {canReview && <button className="btn-secondary text-xs py-1 px-2 flex items-center gap-1" onClick={() => reject(o)}><X className="w-3.5 h-3.5" />退回</button>}
                    {o.status !== 'PAID' && <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" title="刪除" onClick={() => remove(o)}><Trash2 className="w-4 h-4 text-gray-400" /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
