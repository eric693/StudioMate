import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import Modal, { Field } from '../components/Modal';
import SearchBox, { matches } from '../components/SearchBox';
import { Branch, Studio } from '../types';
import { dateTime, setTimeZone } from '../lib/format';

type Tab = 'rules' | 'commerce' | 'refund' | 'terms' | 'contract' | 'branches' | 'logs';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('rules');
  const [s, setS] = useState<Studio | null>(null);
  useEffect(() => { api.get('/studio').then((r) => setS(r.data)); }, []);
  if (!s) return <div className="text-gray-400 text-sm">載入中…</div>;
  const TABS: [Tab, string][] = [['rules', '基本與規則'], ['commerce', '線上購買與發票'], ['refund', '退費與履約保障'], ['terms', '會員條款'], ['contract', '電子合約'], ['branches', '分店'], ['logs', '通知紀錄']];
  return (
    <div className="space-y-4">
      <div className="page-header"><div><h1 className="text-xl font-bold text-gray-800">教室設定</h1></div></div>
      <HowTo module="settings" />
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto max-w-full">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm whitespace-nowrap ${tab === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{l}</button>)}
      </div>
      {tab === 'rules' && <SettingsForm s={s} onSaved={setS} section="rules" />}
      {tab === 'commerce' && <SettingsForm s={s} onSaved={setS} section="commerce" />}
      {tab === 'refund' && <SettingsForm s={s} onSaved={setS} section="refund" />}
      {tab === 'contract' && <Contract s={s} onSaved={setS} />}
      {tab === 'terms' && <Terms s={s} onSaved={setS} />}
      {tab === 'branches' && <Branches />}
      {tab === 'logs' && <Logs />}
    </div>
  );
}

const RULE_KEYS = ['name', 'phone', 'address', 'timezone', 'bookingWindowDays', 'cancelDeadlineHours', 'lateCancelForfeit', 'waitlistEnabled', 'autoAttend',
  'remindBeforeHours', 'expiryRemindDays', 'lowCreditThreshold', 'noShowLimit', 'noShowWindowDays', 'noShowSuspendDays', 'lateCancelCountsAsNoShow',
  'selfCheckIn', 'checkInBeforeMin', 'accessAutoCheckIn'] as const;
const COMMERCE_KEYS = ['onlinePayEnabled', 'transferEnabled', 'bankInfo', 'ecpayMode', 'ecpayMerchantId', 'invoiceEnabled', 'invoiceMode', 'invoiceMerchantId', 'referralRewardAmount',
  'installments', 'installmentMin', 'linePayEnabled', 'linePayMode', 'linePayChannelId'] as const;
const REFUND_KEYS = ['refundFeePercent', 'transferFee', 'trustType', 'trustBank', 'trustNote'] as const;
const NULLABLE = ['phone', 'address', 'bankInfo', 'ecpayMerchantId', 'invoiceMerchantId', 'installments', 'linePayChannelId', 'trustType', 'trustBank', 'trustNote'];

function SettingsForm({ s: initial, onSaved, section }: { s: Studio; onSaved: (s: Studio) => void; section: 'rules' | 'commerce' | 'refund' }) {
  const [s, setS] = useState(initial);
  const [secrets, setSecrets] = useState({ ecpayHashKey: '', ecpayHashIV: '', invoiceHashKey: '', invoiceHashIV: '', linePaySecret: '' });
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Studio>(k: K, v: Studio[K]) => { setS({ ...s, [k]: v }); setSaved(false); };
  const num = (k: keyof Studio, min = 0, max = 999) => ({
    type: 'number', min, max, className: 'input', value: String(s[k] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, +e.target.value as never),
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const keys: readonly string[] = section === 'rules' ? RULE_KEYS : section === 'refund' ? REFUND_KEYS : COMMERCE_KEYS;
    const body: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, NULLABLE.includes(k) ? ((s as unknown as Record<string, unknown>)[k] || null) : (s as unknown as Record<string, unknown>)[k]]));
    if (section === 'commerce') Object.assign(body, Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)));
    const r = await api.put('/studio', body);
    setTimeZone(r.data.timezone);
    setS(r.data); onSaved(r.data);
    setSecrets({ ecpayHashKey: '', ecpayHashIV: '', invoiceHashKey: '', invoiceHashIV: '', linePaySecret: '' });
    setSaved(true);
  }
  const toggle = (k: keyof Studio, label: string, hint?: string) => (
    <label key={k} className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={Boolean(s[k])} onChange={(e) => set(k, e.target.checked as never)} />
      <span><span className="text-sm text-gray-700">{label}</span>{hint && <span className="block text-xs text-gray-400">{hint}</span>}</span>
    </label>
  );
  const secret = (k: keyof typeof secrets, label: string, isSet?: boolean) => (
    <Field key={k} label={label} hint={isSet ? '已設定；留空表示不修改' : undefined}>
      <input className="input font-mono" type="password" autoComplete="off" value={secrets[k]} onChange={(e) => setSecrets({ ...secrets, [k]: e.target.value })} placeholder={isSet ? '••••••••' : ''} />
    </Field>
  );

  return (
    <form onSubmit={save} className="space-y-4">
      {section === 'rules' ? <>
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
            <Field label="可預約幾天內的課"><input {...num('bookingWindowDays', 1, 90)} /></Field>
            <Field label="開課前幾小時截止取消"><input {...num('cancelDeadlineHours', 0, 168)} /></Field>
          </div>
          <div className="divide-y divide-gray-50">
            {toggle('lateCancelForfeit', '晚取消扣堂', '超過取消截止時間才取消，堂數不退回（櫃檯仍可勾選例外退堂）')}
            {toggle('waitlistEnabled', '開放候補', '額滿後可排候補，有人取消時依順序自動遞補並通知')}
            {toggle('autoAttend', '課程結束自動視為出席', '不點名的教室請開啟；關閉時未點名的預約會記為「未到」')}
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">未到違規</h2>
          <p className="text-xs text-gray-400">會員在期間內累計未到達上限，暫停線上預約一段時間（櫃檯仍可幫忙預約）。上限填 0 表示不啟用。</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="計算期間（天）"><input {...num('noShowWindowDays', 1, 365)} /></Field>
            <Field label="未到上限（次）"><input {...num('noShowLimit', 0, 20)} /></Field>
            <Field label="暫停天數"><input {...num('noShowSuspendDays', 1, 90)} /></Field>
          </div>
          {toggle('lateCancelCountsAsNoShow', '晚取消也算一次違規')}
        </div>
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">自助簽到</h2>
            <Link to="/checkin-display" className="btn-secondary text-xs py-1 flex items-center gap-1"><QrCode className="w-3.5 h-3.5" />顯示簽到 QR code</Link>
          </div>
          {toggle('selfCheckIn', '開放會員掃 QR code 簽到', '把 QR code 放在櫃檯平板或印出來，會員用手機掃描即完成點名')}
          <Field label="開課前幾分鐘開放簽到"><input {...num('checkInBeforeMin', 0, 180)} /></Field>
          {toggle('accessAutoCheckIn', '門禁入場時自動簽到', '會員在「門禁入場」掃入場碼時，若有即將開始的預約課，一併記為出席')}
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">LINE 提醒</h2>
          {!s.lineEnabled && <p className="text-xs bg-amber-50 text-amber-700 rounded-lg px-2 py-1.5">尚未設定 LINE 官方帳號，目前為沙盒模式：訊息只會記錄在「通知紀錄」，不會真的送出。</p>}
          <div className="grid grid-cols-3 gap-3">
            <Field label="上課前（小時）" hint="0＝不提醒"><input {...num('remindBeforeHours', 0, 72)} /></Field>
            <Field label="到期前（天）" hint="0＝不提醒"><input {...num('expiryRemindDays', 0, 60)} /></Field>
            <Field label="剩幾堂時提醒" hint="0＝不提醒"><input {...num('lowCreditThreshold', 0, 50)} /></Field>
          </div>
        </div>
      </> : section === 'refund' ? <>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">退費與轉讓</h2>
          <p className="text-xs text-gray-400">退費試算＝售價 × 未使用比例（堂數卡看剩餘堂數、期限卡看剩餘天數），再扣下面的手續費。實退金額在辦理時仍可調整。手續費比例請與會員條款、合約內容一致。</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="退費手續費（剩餘金額的 %）"><input {...num('refundFeePercent', 0, 100)} /></Field>
            <Field label="轉讓手續費（元）"><input {...num('transferFee', 0, 100000)} /></Field>
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">預收款履約保障</h2>
          <p className="text-xs text-gray-400">先收款後提供服務的方案（堂數卡、期限卡）屬於預收款。與銀行簽訂信託或履約保證後填在這裡，會顯示在會員購買頁與合約上；「營收報表 → 預收款」可查目前尚未履約的金額。</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="保障方式"><select className="input" value={s.trustType ?? ''} onChange={(e) => set('trustType', (e.target.value || null) as Studio['trustType'])}>
              <option value="">未提供</option><option value="TRUST">信託</option><option value="GUARANTEE">銀行履約保證</option>
            </select></Field>
            <Field label="合作銀行"><input className="input" value={s.trustBank ?? ''} onChange={(e) => set('trustBank', e.target.value)} placeholder="例如：○○商業銀行" /></Field>
          </div>
          <Field label="說明（選填）"><input className="input" value={s.trustNote ?? ''} onChange={(e) => set('trustNote', e.target.value)} placeholder="例如：保證額度新台幣 100 萬元，期間至 2027/12/31" /></Field>
        </div>
      </> : <>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">線上刷卡（綠界）</h2>
          {toggle('onlinePayEnabled', '開放會員在手機網頁刷卡購買方案', '到「方案與課程」把要線上販售的方案勾選「開放線上購買」')}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="環境"><select className="input" value={s.ecpayMode} onChange={(e) => set('ecpayMode', e.target.value as Studio['ecpayMode'])}>
              <option value="stage">測試環境（不會真的扣款）</option><option value="production">正式環境</option>
            </select></Field>
            <Field label="特店編號 MerchantID"><input className="input font-mono" value={s.ecpayMerchantId ?? ''} onChange={(e) => set('ecpayMerchantId', e.target.value)} placeholder="向綠界申請後取得" /></Field>
            {secret('ecpayHashKey', 'HashKey', s.ecpayHashKeySet)}
            {secret('ecpayHashIV', 'HashIV', s.ecpayHashIVSet)}
          </div>
          {s.ecpayMode === 'stage' && <p className="text-xs text-gray-400">測試環境使用綠界公開的測試帳號，可用測試卡號 4311-9522-2222-2222（任意未過期日期、安全碼 222）體驗完整流程。</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="信用卡分期期數" hint="例如 3,6,12；留空＝不開放分期（需先向綠界申請分期服務）"><input className="input font-mono" value={s.installments ?? ''} onChange={(e) => set('installments', e.target.value)} placeholder="3,6,12" /></Field>
            <Field label="最低分期金額"><input {...num('installmentMin', 0, 10_000_000)} /></Field>
          </div>
          <p className="text-xs text-gray-400">方案勾選「定期定額」後，會員可以選擇每月自動扣款（綠界信用卡定期定額），每期扣款成功自動續一張方案，扣款失敗會用 LINE 通知會員。</p>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">LINE Pay</h2>
          {toggle('linePayEnabled', '開放會員用 LINE Pay 購買方案', '需先向 LINE Pay 申請商店，取得 Channel ID 與 Channel Secret Key')}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="環境"><select className="input" value={s.linePayMode} onChange={(e) => set('linePayMode', e.target.value as Studio['linePayMode'])}>
              <option value="sandbox">測試環境（Sandbox）</option><option value="production">正式環境</option>
            </select></Field>
            <Field label="Channel ID"><input className="input font-mono" value={s.linePayChannelId ?? ''} onChange={(e) => set('linePayChannelId', e.target.value)} /></Field>
            {secret('linePaySecret', 'Channel Secret Key', s.linePaySecretSet)}
          </div>
          <p className="text-xs text-gray-400">LINE Pay 付款的方案退費時，會直接退款到會員的 LINE Pay。</p>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">銀行轉帳</h2>
          {toggle('transferEnabled', '開放會員轉帳購買', '會員下單後回報帳號後五碼，櫃檯在「線上訂單」核對入帳後通過')}
          <Field label="轉帳資訊（會顯示給會員）"><textarea className="input" rows={3} value={s.bankInfo ?? ''} onChange={(e) => set('bankInfo', e.target.value)} placeholder={'台灣銀行（004）\n帳號 123-456-789012\n戶名 晨光瑜珈工作室'} /></Field>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">電子發票（綠界）</h2>
          {toggle('invoiceEnabled', '售卡後自動開立電子發票', '櫃檯售卡與線上購買都會開立；作廢方案時自動作廢發票。也可以在銷售紀錄手動開立')}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="環境"><select className="input" value={s.invoiceMode} onChange={(e) => set('invoiceMode', e.target.value as Studio['invoiceMode'])}>
              <option value="stage">測試環境（不會真的開立）</option><option value="production">正式環境</option>
            </select></Field>
            <Field label="發票特店編號"><input className="input font-mono" value={s.invoiceMerchantId ?? ''} onChange={(e) => set('invoiceMerchantId', e.target.value)} /></Field>
            {secret('invoiceHashKey', 'HashKey', s.invoiceHashKeySet)}
            {secret('invoiceHashIV', 'HashIV', s.invoiceHashIVSet)}
          </div>
          <p className="text-xs text-gray-400">會員可在手機網頁設定手機條碼、自然人憑證、捐贈或公司統編；沒設定時開立會員載具並寄送到會員 Email。</p>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-gray-700">轉介紹獎勵</h2>
          <Field label="介紹人獲得的折價券金額" hint="被介紹的新會員首次購買後自動發送；0＝不啟用"><input {...num('referralRewardAmount', 0, 100000)} /></Field>
        </div>
      </>}
      <div className="flex items-center gap-3">
        <button className="btn-primary">儲存設定</button>
        {saved && <span className="text-sm text-green-600">已儲存</span>}
      </div>
    </form>
  );
}

function Terms({ s, onSaved }: { s: Studio; onSaved: (s: Studio) => void }) {
  const [text, setText] = useState(s.terms ?? '');
  const [msg, setMsg] = useState('');
  async function publish() {
    if (!confirm(text.trim() ? '發布新版條款？所有會員下次預約或購買前都需要重新同意。' : '清空條款？會員將不再需要同意條款。')) return;
    const r = await api.put('/studio/terms', { terms: text });
    onSaved(r.data); setMsg(text.trim() ? `已發布第 ${r.data.termsVersion} 版` : '已清空條款');
  }
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">會員條款</h2>
        <span className="text-xs text-gray-400">{s.terms ? `目前第 ${s.termsVersion} 版` : '尚未設定'}</span>
      </div>
      <p className="text-xs text-gray-400">例如取消與退費規定、課程注意事項、健康聲明、個資使用說明。會員第一次預約或購買前會看到條款並勾選同意；發布新版後需重新同意。會員頁可查看是否已同意最新版。</p>
      <textarea className="input font-[inherit]" rows={14} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000}
        placeholder={'一、預約與取消\n1. 開課前 12 小時以前取消，堂數全額退回；之後取消視為晚取消，扣除堂數。\n2. 未到課且未取消者扣除堂數。\n\n二、方案效期與退費\n……\n\n三、健康聲明\n本人確認身體狀況適合參加課程……'} />
      {msg && <div className="text-sm bg-green-50 text-green-700 rounded-xl px-3 py-2">{msg}</div>}
      <button className="btn-primary" disabled={text === (s.terms ?? '')} onClick={publish}>{text.trim() ? '發布新版條款' : '清空條款'}</button>
    </div>
  );
}

function Branches() {
  const [list, setList] = useState<Branch[]>([]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const load = () => api.get('/branches').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  const shown = list.filter((b) => matches(q, b.name, b.address, b.phone) && (!active || (active === 'on') === b.active));
  async function remove(b: Branch) {
    if (!confirm(`刪除分店「${b.name}」？`)) return;
    await api.delete(`/branches/${b.id}`); load();
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">有多間分店時，課表、固定課表與場地可以指定分店；會員和方案在各分店通用，會員網頁可依分店篩選課表。只有一間店不需要設定。</p>
      <div className="flex flex-wrap gap-2 items-center">
        <SearchBox value={q} onChange={setQ} placeholder="搜尋分店名稱、地址、電話" />
        <select className="input w-auto text-sm" value={active} onChange={(e) => setActive(e.target.value)} aria-label="狀態"><option value="">全部狀態</option><option value="on">營業中</option><option value="off">停用</option></select>
        <button className="btn-primary flex items-center gap-1 ml-auto" onClick={() => setEditing('new')}><Plus className="w-4 h-4" />新增分店</button>
      </div>
      <div className="card p-0 overflow-hidden">
        {shown.length === 0 ? <p className="text-sm text-gray-400 p-4">{list.length ? '沒有符合條件的分店。' : '還沒有分店。'}</p> : (
          <div className="divide-y divide-gray-50">
            {shown.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 px-4 py-3 ${b.active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{b.name}{!b.active && <span className="text-xs text-gray-400 ml-2">停用</span>}</div>
                  <div className="text-xs text-gray-400 truncate">{[b.address, b.phone].filter(Boolean).join('・')}</div>
                </div>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" onClick={() => setEditing(b)}><Pencil className="w-4 h-4 text-gray-400" /></button>
                <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" onClick={() => remove(b)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <BranchForm b={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function BranchForm({ b, onClose, onSaved }: { b: Branch | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: b?.name ?? '', address: b?.address ?? '', phone: b?.phone ?? '', active: b?.active ?? true });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, address: f.address || null, phone: f.phone || null };
    if (b) await api.put(`/branches/${b.id}`, body); else await api.post('/branches', body);
    onSaved();
  }
  return (
    <Modal title={b ? '編輯分店' : '新增分店'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="分店名稱"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="例如：信義店" /></Field>
        <Field label="地址"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="電話"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />營業中</label>
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}

interface Log { id: string; kind: string; channel: string; message: string; memberName: string; createdAt: string }
const KIND: Record<string, string> = {
  CLASS: '上課提醒', EXPIRY: '到期提醒', LOW_CREDIT: '堂數提醒', PROMOTED: '候補遞補', SESSION_CANCELLED: '停課通知',
  CAMPAIGN: '群發訊息', REFERRAL: '轉介紹獎勵', ORDER_PAID: '付款完成', ORDER_REJECTED: '轉帳退回',
};

function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [lf, setLf] = useState({ q: '', kind: '', channel: '' });
  useEffect(() => {
    const t = setTimeout(() => api.get('/studio/notifications', { params: lf }).then((r) => setLogs(r.data)), 250);
    return () => clearTimeout(t);
  }, [lf]);
  return (
    <div className="card">
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
  );
}

/** 電子合約：開啟後，會員線上購買前需手寫簽名；櫃檯售卡後也可在會員頁「簽約」 */
function Contract({ s, onSaved }: { s: Studio; onSaved: (s: Studio) => void }) {
  const [tpl, setTpl] = useState<{ defaultText: string; vars: string[] } | null>(null);
  const [text, setText] = useState(s.contractText ?? '');
  const [enabled, setEnabled] = useState(s.contractEnabled);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.get('/contracts/template').then((r) => { setTpl(r.data); if (!s.contractText) setText(r.data.defaultText); }); }, [s.contractText]);
  async function save() {
    const r = await api.put('/studio', { contractEnabled: enabled, contractText: text.trim() || null });
    onSaved(r.data); setSaved(true);
  }
  return (
    <div className="card space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" className="mt-1" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />
        <span><span className="text-sm text-gray-700">會員線上購買前必須簽署合約</span><span className="block text-xs text-gray-400">會員在手機上閱讀合約並手寫簽名後才能付款。合約內容與簽名會存檔，之後修改範本不影響已簽的合約。</span></span>
      </label>
      <Field label="合約範本" hint={tpl ? `可用變數：${tpl.vars.join('、')}` : undefined}>
        <textarea className="input font-mono text-xs leading-relaxed" rows={18} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
      </Field>
      <p className="text-xs text-gray-400">預設範本只是起點，請依教室實際的退費、轉讓規定修改，必要時請法律專業人士審閱。</p>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save}>儲存</button>
        {tpl && <button className="btn-secondary" onClick={() => { setText(tpl.defaultText); setSaved(false); }}>還原預設範本</button>}
        {saved && <span className="text-sm text-green-600">已儲存</span>}
      </div>
    </div>
  );
}
