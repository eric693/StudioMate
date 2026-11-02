import { useEffect, useState } from 'react';
import { MapPin, Phone, Gift, CalendarPlus, Receipt, Copy, Share2 } from 'lucide-react';
import memberApi, { errorText } from './memberApi';
import { CARRIER, PLAN_KIND, dateStr, money } from '../../lib/format';
import { Me, Notify } from './types';

interface MyCoupon { code: string; name: string; discountType: 'AMOUNT' | 'PERCENT'; value: number; validTo: string | null }

export default function MeTab({ me, onChange }: { me: Me; onChange: Notify }) {
  const [coupons, setCoupons] = useState<MyCoupon[]>([]);
  const [ref, setRef] = useState<{ code: string; count: number; reward: number } | null>(null);
  useEffect(() => {
    memberApi.get('/coupons').then((r) => setCoupons(r.data));
    memberApi.get('/referral').then((r) => setRef(r.data));
  }, []);
  const calUrl = `${location.origin}/api/cal/${me.member.calendarToken}.ics`;
  const copy = (text: string, msg: string) => navigator.clipboard?.writeText(text).then(() => onChange(msg), () => undefined);
  async function share() {
    if (!ref) return;
    const text = `我在${me.studio.name}上課，推薦你一起來！入會時告訴櫃檯我的推薦碼 ${ref.code}`;
    if (navigator.share) await navigator.share({ text }).catch(() => undefined); else copy(text, '已複製推薦訊息');
  }

  return (
    <div className="space-y-3">
      {me.passes.length === 0 ? <div className="card text-sm text-gray-400 text-center py-8">目前沒有有效方案</div> : me.passes.map((p) => (
        <div key={p.id} className="card">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-800">{p.planName}</span>
            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded">{PLAN_KIND[p.kind]}</span>
            {p.status === 'FROZEN' && <span className="text-xs bg-sky-50 text-sky-600 px-1.5 rounded">凍結中</span>}
          </div>
          <div className="mt-2">
            {p.kind === 'PERIOD' ? <span className="text-lg font-bold text-brand">不限堂數</span>
              : <><span className="text-3xl font-bold text-brand">{p.creditsLeft}</span><span className="text-sm text-gray-400"> / {p.creditsTotal} 堂</span></>}
          </div>
          {p.kind !== 'PERIOD' && p.creditsTotal ? (
            <div className="h-1.5 bg-gray-100 rounded-full mt-2"><div className="h-full bg-brand rounded-full" style={{ width: `${((p.creditsLeft ?? 0) / p.creditsTotal) * 100}%` }} /></div>
          ) : null}
          <div className="text-xs text-gray-400 mt-2">{dateStr(p.startDate)} ~ {dateStr(p.endDate)}{p.status === 'FROZEN' && p.frozenUntil ? `・凍結至 ${dateStr(p.frozenUntil)}` : ''}</div>
        </div>
      ))}

      {coupons.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5"><Gift className="w-4 h-4 text-brand" />我的折價券</div>
          <div className="space-y-2">
            {coupons.map((c) => (
              <div key={c.code} className="flex items-center justify-between bg-brand/5 rounded-xl px-3 py-2">
                <div><div className="text-sm text-gray-800">{c.name}</div><div className="text-xs text-gray-500">{c.discountType === 'AMOUNT' ? `折 ${money(c.value)}` : `${100 - c.value} 折`}{c.validTo ? `・${dateStr(c.validTo)} 前使用` : ''}</div></div>
                <button className="font-mono text-sm text-brand flex items-center gap-1" onClick={() => copy(c.code, '已複製折價券代碼')}>{c.code}<Copy className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {ref && (
        <div className="card space-y-2">
          <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Share2 className="w-4 h-4 text-brand" />推薦朋友</div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold tracking-widest text-gray-800">{ref.code}</span>
            <button className="btn-secondary text-xs py-1" onClick={share}>分享</button>
          </div>
          <p className="text-xs text-gray-500">朋友入會時告訴櫃檯這組推薦碼{ref.reward ? `，朋友首次購買後你會獲得 ${money(ref.reward)} 折價券` : ''}。已推薦 {ref.count} 位。</p>
        </div>
      )}

      <div className="card space-y-2">
        <div className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><CalendarPlus className="w-4 h-4 text-brand" />加入手機行事曆</div>
        <p className="text-xs text-gray-500">訂閱後，預約的課程會自動出現在 Google 日曆或 iPhone 行事曆，取消也會同步。</p>
        <div className="flex gap-2">
          <a className="btn-primary text-sm flex-1 text-center" href={calUrl.replace(/^https?:/, 'webcal:')}>iPhone／Mac 訂閱</a>
          <a className="btn-secondary text-sm flex-1 text-center" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calUrl.replace(/^https?:/, 'webcal:'))}`} target="_blank" rel="noreferrer">Google 日曆</a>
        </div>
        <button className="text-xs text-gray-400 underline" onClick={() => copy(calUrl, '已複製行事曆網址')}>複製訂閱網址</button>
      </div>

      {me.studio.invoiceEnabled && <InvoiceSettings me={me} onChange={onChange} />}

      <div className="card text-sm text-gray-600 space-y-1.5">
        <div className="font-medium text-gray-700">{me.studio.name}</div>
        {me.studio.phone && <a href={`tel:${me.studio.phone}`} className="flex items-center gap-2 text-brand"><Phone className="w-4 h-4" />{me.studio.phone}</a>}
        {me.studio.address && <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" />{me.studio.address}</div>}
      </div>
    </div>
  );
}

function InvoiceSettings({ me, onChange }: { me: Me; onChange: Notify }) {
  const m = me.member;
  const [f, setF] = useState({ email: m.email ?? '', invoiceCarrierType: m.invoiceCarrierType ?? '', invoiceCarrierNum: m.invoiceCarrierNum ?? '', invoiceTaxId: m.invoiceTaxId ?? '', invoiceTitle: m.invoiceTitle ?? '' });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    try {
      await memberApi.put('/me', { ...f, invoiceCarrierNum: f.invoiceCarrierNum || null, invoiceTitle: f.invoiceTitle || null });
      setOpen(false); onChange('發票設定已儲存');
    } catch (e) { setErr(errorText(e)); }
  }
  return (
    <div className="card space-y-2">
      <button className="w-full flex items-center justify-between" onClick={() => setOpen(!open)}>
        <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Receipt className="w-4 h-4 text-brand" />發票設定</span>
        <span className="text-xs text-gray-400">{CARRIER[m.invoiceCarrierType ?? '']}</span>
      </button>
      {open && <>
        <label className="block text-xs text-gray-500">Email（發票通知）<input className="input mt-1" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="block text-xs text-gray-500">載具
          <select className="input mt-1" value={f.invoiceCarrierType} onChange={(e) => setF({ ...f, invoiceCarrierType: e.target.value })}>{Object.entries(CARRIER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        {f.invoiceCarrierType === 'MOBILE' && <label className="block text-xs text-gray-500">手機條碼<input className="input mt-1 font-mono uppercase" value={f.invoiceCarrierNum} onChange={(e) => setF({ ...f, invoiceCarrierNum: e.target.value.toUpperCase() })} placeholder="/ABC1234" maxLength={8} /></label>}
        {f.invoiceCarrierType === 'CITIZEN' && <label className="block text-xs text-gray-500">自然人憑證條碼<input className="input mt-1 font-mono uppercase" value={f.invoiceCarrierNum} onChange={(e) => setF({ ...f, invoiceCarrierNum: e.target.value.toUpperCase() })} placeholder="AB12345678901234" maxLength={16} /></label>}
        {f.invoiceCarrierType === 'DONATE' && <label className="block text-xs text-gray-500">愛心碼<input className="input mt-1 font-mono" inputMode="numeric" value={f.invoiceCarrierNum} onChange={(e) => setF({ ...f, invoiceCarrierNum: e.target.value.replace(/\D/g, '') })} maxLength={7} /></label>}
        {f.invoiceCarrierType === 'COMPANY' && <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-gray-500">統一編號<input className="input mt-1 font-mono" inputMode="numeric" value={f.invoiceTaxId} onChange={(e) => setF({ ...f, invoiceTaxId: e.target.value.replace(/\D/g, '') })} maxLength={8} /></label>
          <label className="block text-xs text-gray-500">公司抬頭<input className="input mt-1" value={f.invoiceTitle} onChange={(e) => setF({ ...f, invoiceTitle: e.target.value })} /></label>
        </div>}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <button className="btn-primary w-full" onClick={save}>儲存</button>
      </>}
    </div>
  );
}
