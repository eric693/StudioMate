import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Landmark, ChevronLeft } from 'lucide-react';
import memberApi, { errorText } from './memberApi';
import { ORDER_STATUS, PLAN_KIND, dateTime, localDay, money } from '../../lib/format';
import { Order } from '../../types';
import { Me, Notify } from './types';

interface ShopPlan { id: string; name: string; kind: string; credits: number | null; validDays: number; price: number; description: string | null; dailyLimit: number | null; trialOnly: boolean; classTypes: string[] }
interface Shop { onlinePay: boolean; transfer: boolean; bankInfo: string | null; testMode: boolean; plans: ShopPlan[] }

/** 把綠界付款表單送出（整頁導向綠界） */
function submitToEcpay(action: string, fields: Record<string, string>) {
  const form = document.createElement('form');
  form.method = 'POST'; form.action = action;
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = k; input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export default function ShopTab({ me, orderId, onChange }: { me: Me; orderId: string | null; onChange: Notify }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [plan, setPlan] = useState<ShopPlan | null>(null);
  const loadOrders = useCallback(() => memberApi.get('/orders').then((r) => setOrders(r.data)), []);
  useEffect(() => { memberApi.get('/shop').then((r) => setShop(r.data)); loadOrders(); }, [loadOrders]);

  // 從綠界付款頁回來：付款結果是綠界伺服器另外通知，可能晚幾秒，輪詢幾次
  useEffect(() => {
    if (!orderId) return;
    let n = 0;
    const t = setInterval(async () => {
      const r = await memberApi.get('/orders');
      setOrders(r.data);
      const o = (r.data as Order[]).find((x) => x.id === orderId);
      if (o?.status === 'PAID') { clearInterval(t); onChange(`付款完成！「${o.plan.name}」已加入您的帳戶`); }
      if (++n >= 10 || (o && o.status !== 'PENDING')) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shop) return <p className="text-sm text-gray-400">載入中…</p>;
  if (plan) return <Checkout me={me} shop={shop} plan={plan} onBack={() => setPlan(null)} onDone={(m) => { setPlan(null); loadOrders(); onChange(m); }} />;

  const waiting = orders.filter((o) => o.status === 'PENDING');
  return (
    <div className="space-y-3">
      {waiting.map((o) => <PendingOrder key={o.id} o={o} shop={shop} onChanged={(m) => { loadOrders(); if (m) onChange(m); }} />)}
      {shop.plans.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">目前沒有開放線上購買的方案，請洽櫃檯</div> : shop.plans.map((p) => (
        <button key={p.id} className="card w-full text-left flex items-center gap-3 hover:shadow" onClick={() => setPlan(p)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2"><span className="font-semibold text-gray-800">{p.name}</span>
              {p.trialOnly && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 rounded">新朋友限定</span>}</div>
            <div className="text-xs text-gray-500 mt-0.5">{PLAN_KIND[p.kind]}・{p.kind === 'PERIOD' ? `期間內不限堂數${p.dailyLimit ? `（每日 ${p.dailyLimit} 堂）` : ''}` : `${p.credits} 堂`}・{p.validDays} 天內有效</div>
            {p.classTypes.length > 0 && <div className="text-xs text-gray-400">限 {p.classTypes.join('、')}</div>}
            {p.description && <div className="text-xs text-gray-400 mt-1">{p.description}</div>}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-brand">{money(p.price).replace('NT$ ', '$')}</div>
            {p.kind === 'PACK' && p.credits && p.credits > 1 && <div className="text-[10px] text-gray-400">每堂 ${Math.round(p.price / p.credits)}</div>}
          </div>
        </button>
      ))}
      {orders.filter((o) => o.status !== 'PENDING').length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-gray-700 mb-2">購買紀錄</div>
          <div className="divide-y divide-gray-50">
            {orders.filter((o) => o.status !== 'PENDING').map((o) => (
              <div key={o.id} className="py-2 flex items-center justify-between text-sm">
                <div><div className="text-gray-700">{o.plan.name}</div><div className="text-xs text-gray-400">{dateTime(o.createdAt)}・{o.method === 'ONLINE' ? '刷卡' : '轉帳'}{o.rejectReason ? `・${o.rejectReason}` : ''}</div></div>
                <div className="text-right"><div className="text-gray-700">{money(o.amount)}</div><span className={`text-[11px] px-1.5 rounded-full ${ORDER_STATUS[o.status].cls}`}>{ORDER_STATUS[o.status].label}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Checkout({ me, shop, plan, onBack, onDone }: { me: Me; shop: Shop; plan: ShopPlan; onBack: () => void; onDone: Notify }) {
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<{ discount: number; amount: number; name: string | null } | null>(null);
  const [method, setMethod] = useState<'ONLINE' | 'TRANSFER'>(shop.onlinePay ? 'ONLINE' : 'TRANSFER');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = quote?.amount ?? plan.price;

  async function apply() {
    setErr('');
    try { setQuote((await memberApi.post('/quote', { planId: plan.id, code })).data); } catch (e) { setQuote(null); setErr(errorText(e)); }
  }
  async function buy() {
    setErr(''); setBusy(true);
    try {
      const r = await memberApi.post('/orders', { planId: plan.id, method, couponCode: quote ? code : null });
      if (r.data.free) { onDone(`「${plan.name}」已加入您的帳戶`); return; }
      if (method === 'ONLINE') {
        const f = await memberApi.post(`/orders/${r.data.order.id}/pay`);
        submitToEcpay(f.data.action, f.data.fields);
        return;
      }
      onDone('訂單已建立，請轉帳後回報帳號後五碼');
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <button className="text-sm text-gray-500 flex items-center gap-1" onClick={onBack}><ChevronLeft className="w-4 h-4" />返回方案</button>
      <div className="card">
        <div className="font-semibold text-gray-800">{plan.name}</div>
        <div className="text-xs text-gray-500 mt-0.5">{PLAN_KIND[plan.kind]}・{plan.kind === 'PERIOD' ? '期間內不限堂數' : `${plan.credits} 堂`}・購買後 {plan.validDays} 天內有效</div>
        {plan.description && <div className="text-xs text-gray-400 mt-1">{plan.description}</div>}
      </div>
      <div className="card space-y-2">
        <div className="text-sm font-medium text-gray-700">折價券</div>
        <div className="flex gap-2">
          <input className="input font-mono uppercase" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setQuote(null); }} placeholder="輸入代碼（選填）" />
          <button className="btn-secondary whitespace-nowrap" disabled={!code} onClick={apply}>套用</button>
        </div>
        {quote && <div className="text-xs text-green-600">{quote.name}：折抵 {money(quote.discount)}</div>}
      </div>
      <div className="card space-y-2">
        <div className="text-sm font-medium text-gray-700">付款方式</div>
        {shop.onlinePay && (
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${method === 'ONLINE' ? 'border-brand bg-brand/5' : 'border-gray-200'}`}>
            <input type="radio" checked={method === 'ONLINE'} onChange={() => setMethod('ONLINE')} /><CreditCard className="w-5 h-5 text-gray-500" />
            <div><div className="text-sm text-gray-800">信用卡（綠界）</div><div className="text-xs text-gray-400">付款完成立即開通</div></div>
          </label>
        )}
        {shop.transfer && (
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${method === 'TRANSFER' ? 'border-brand bg-brand/5' : 'border-gray-200'}`}>
            <input type="radio" checked={method === 'TRANSFER'} onChange={() => setMethod('TRANSFER')} /><Landmark className="w-5 h-5 text-gray-500" />
            <div><div className="text-sm text-gray-800">銀行轉帳</div><div className="text-xs text-gray-400">轉帳後回報後五碼，教室核對後開通</div></div>
          </label>
        )}
        {method === 'ONLINE' && shop.testMode && <p className="text-xs text-amber-600">目前為測試環境，不會真的扣款。測試卡號 4311-9522-2222-2222，有效期限任意未來日期，安全碼 222。</p>}
        {me.studio.invoiceEnabled && <p className="text-xs text-gray-400">付款後開立電子發票，載具可在「我的 → 發票設定」修改。</p>}
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <div className="card flex items-center justify-between">
        <div><div className="text-xs text-gray-400">應付金額</div><div className="text-xl font-bold text-gray-800">{money(amount)}</div>{quote?.discount ? <div className="text-xs text-gray-400 line-through">{money(plan.price)}</div> : null}</div>
        <button className="btn-primary px-6 py-3" disabled={busy} onClick={buy}>{busy ? '處理中…' : method === 'ONLINE' ? '前往付款' : '建立訂單'}</button>
      </div>
    </div>
  );
}

function PendingOrder({ o, shop, onChanged }: { o: Order; shop: Shop; onChanged: (msg?: string) => void }) {
  const [last5, setLast5] = useState('');
  const [date, setDate] = useState(localDay());
  const [err, setErr] = useState('');
  async function report() {
    setErr('');
    try { await memberApi.post(`/orders/${o.id}/transfer`, { last5, transferAt: date }); onChanged('已回報，教室核對入帳後會通知您'); } catch (e) { setErr(errorText(e)); }
  }
  async function pay() {
    try { const f = await memberApi.post(`/orders/${o.id}/pay`); submitToEcpay(f.data.action, f.data.fields); } catch (e) { setErr(errorText(e)); }
  }
  async function cancel() {
    if (!confirm('取消這筆訂單？')) return;
    await memberApi.post(`/orders/${o.id}/cancel`); onChanged('訂單已取消');
  }
  return (
    <div className="card border border-amber-200 space-y-2">
      <div className="flex items-center justify-between">
        <div><div className="text-sm font-medium text-gray-800">{o.plan.name}</div><div className="text-xs text-gray-400">{dateTime(o.createdAt)}・{o.tradeNo}</div></div>
        <div className="text-right"><div className="font-semibold text-gray-800">{money(o.amount)}</div><span className="text-[11px] bg-amber-50 text-amber-600 px-1.5 rounded-full">{o.method === 'TRANSFER' && o.transferLast5 ? '待教室確認' : '待付款'}</span></div>
      </div>
      {o.method === 'TRANSFER' && !o.transferLast5 && <>
        {shop.bankInfo && <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 whitespace-pre-wrap">{shop.bankInfo}</div>}
        <div className="grid grid-cols-2 gap-2">
          <input className="input font-mono" inputMode="numeric" maxLength={5} value={last5} onChange={(e) => setLast5(e.target.value.replace(/\D/g, ''))} placeholder="帳號後五碼" aria-label="帳號後五碼" />
          <input type="date" className="input" value={date} max={localDay()} onChange={(e) => setDate(e.target.value)} aria-label="轉帳日期" />
        </div>
        <button className="btn-primary w-full" disabled={last5.length !== 5} onClick={report}>回報轉帳</button>
      </>}
      {o.method === 'TRANSFER' && o.transferLast5 && <p className="text-xs text-gray-500">已回報帳號後五碼 {o.transferLast5}，教室核對入帳後會通知您。</p>}
      {o.method === 'ONLINE' && <button className="btn-primary w-full" onClick={pay}>前往付款</button>}
      {err && <p className="text-sm text-red-500">{err}</p>}
      <button className="text-xs text-gray-400 underline" onClick={cancel}>取消訂單</button>
    </div>
  );
}
