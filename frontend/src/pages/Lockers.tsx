import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import Modal, { Field } from '../components/Modal';
import MemberPicker, { PickedMember } from '../components/MemberPicker';
import { PAY_METHOD, dateStr, localDay, money } from '../lib/format';

interface Rental { id: string; startDate: string; endDate: string; price: number; member: { id: string; name: string; phone: string } }
interface Locker { id: string; code: string; size: string | null; monthlyRate: number; active: boolean; note: string | null; rental: Rental | null; overdue: boolean }

/** 置物櫃：櫃位一覽（空櫃、租用中、逾期），點選出租、續租、退租 */
export default function Lockers() {
  const [list, setList] = useState<Locker[] | null>(null);
  const [open, setOpen] = useState<Locker | null>(null);
  const [bulk, setBulk] = useState(false);
  const [filter, setFilter] = useState<'all' | 'free' | 'rented' | 'overdue'>('all');
  const load = () => api.get('/lockers').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  const soon = (l: Locker) => l.rental && !l.overdue && l.rental.endDate.slice(0, 10) <= addDaysStr(7);
  const shown = (list ?? []).filter((l) => filter === 'all' || (filter === 'free' ? !l.rental && l.active : filter === 'rented' ? !!l.rental : l.overdue));
  const count = (f: typeof filter) => (list ?? []).filter((l) => f === 'free' ? !l.rental && l.active : f === 'rented' ? !!l.rental : l.overdue).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {([['all', '全部'], ['free', `空櫃 ${count('free')}`], ['rented', `租用中 ${count('rented')}`], ['overdue', `逾期 ${count('overdue')}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`text-xs px-3 py-1 rounded-full ${filter === k ? 'bg-brand text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>{l}</button>
        ))}
        <button className="btn-primary ml-auto" onClick={() => setBulk(true)}>新增置物櫃</button>
      </div>
      {list && list.length === 0 && <div className="card text-sm text-gray-500">還沒有置物櫃。按「新增置物櫃」一次建立一整排（例如 A01 ~ A30）。</div>}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2">
        {shown.map((l) => (
          <button key={l.id} onClick={() => setOpen(l)} className={`rounded-xl p-2 text-left border text-xs min-h-[4.5rem] ${!l.active ? 'bg-gray-50 border-gray-100 text-gray-300' : l.overdue ? 'bg-red-50 border-red-200' : soon(l) ? 'bg-amber-50 border-amber-200' : l.rental ? 'bg-brand/5 border-brand/20' : 'bg-white border-gray-200'}`}>
            <div className="font-mono font-semibold text-sm text-gray-800">{l.code}</div>
            {l.rental ? <><div className="truncate text-gray-700">{l.rental.member.name}</div><div className={l.overdue ? 'text-red-500' : 'text-gray-400'}>{dateStr(l.rental.endDate).slice(5)} 到期</div></> : <div className="text-gray-400">{l.active ? '空櫃' : '停用'}</div>}
          </button>
        ))}
      </div>
      {open && <LockerModal l={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />}
      {bulk && <BulkForm onClose={() => setBulk(false)} onSaved={() => { setBulk(false); load(); }} />}
    </div>
  );
}

const addDaysStr = (n: number) => { const d = new Date(localDay()); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function LockerModal({ l, onClose, onSaved }: { l: Locker; onClose: () => void; onSaved: () => void }) {
  const [member, setMember] = useState<PickedMember | null>(null);
  const [f, setF] = useState({ startDate: localDay(), months: '1', price: String(l.monthlyRate), payMethod: 'CASH' });
  const [rate, setRate] = useState(String(l.monthlyRate));
  async function rent(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    await api.post(`/lockers/${l.id}/rent`, { memberId: member.id, startDate: f.startDate, months: +f.months, price: +f.price, payMethod: f.payMethod });
    onSaved();
  }
  async function extend() {
    await api.put(`/lockers/rentals/${l.rental!.id}`, { action: 'extend', months: +f.months, price: +f.price, payMethod: f.payMethod }); onSaved();
  }
  async function end() {
    if (!confirm(`${l.rental!.member.name} 退租 ${l.code}？`)) return;
    await api.put(`/lockers/rentals/${l.rental!.id}`, { action: 'end' }); onSaved();
  }
  async function saveLocker(patch: object) { await api.put(`/lockers/${l.id}`, patch); onSaved(); }
  const months = (
    <div className="grid grid-cols-3 gap-2">
      <Field label="月數"><input type="number" min={1} max={36} className="input" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value, price: String(l.monthlyRate * (+e.target.value || 0)) })} /></Field>
      <Field label="金額"><input type="number" min={0} className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
      <Field label="付款"><select className="input" value={f.payMethod} onChange={(e) => setF({ ...f, payMethod: e.target.value })}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
    </div>
  );
  return (
    <Modal title={`置物櫃 ${l.code}${l.size ? `（${l.size}）` : ''}`} onClose={onClose}>
      {l.rental ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-gray-50 p-3 text-sm">
            <Link to={`/members/${l.rental.member.id}`} className="font-medium text-gray-800 hover:text-brand">{l.rental.member.name}</Link><span className="text-gray-400 ml-2">{l.rental.member.phone}</span>
            <div className={`text-xs mt-1 ${l.overdue ? 'text-red-500' : 'text-gray-500'}`}>{dateStr(l.rental.startDate)} ~ {dateStr(l.rental.endDate)}{l.overdue ? '（已逾期）' : ''}・{money(l.rental.price)}</div>
          </div>
          <div className="text-sm font-medium text-gray-700">續租</div>
          {months}
          <button className="btn-primary w-full" onClick={extend}>續租</button>
          <button className="btn-danger w-full" onClick={end}>退租</button>
        </div>
      ) : (
        <form onSubmit={rent} className="space-y-3">
          {!l.active ? <p className="text-sm text-gray-500">這個置物櫃已停用。</p> : (
            <>
              <Field label="租用會員"><MemberPicker value={member} onChange={setMember} /></Field>
              <Field label="開始日期"><input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              {months}
              <button className="btn-primary w-full" disabled={!member}>出租</button>
            </>
          )}
          <div className="border-t border-gray-100 pt-3 flex items-end gap-2">
            <Field label="月租"><input type="number" min={0} className="input" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <button type="button" className="btn-secondary" onClick={() => saveLocker({ monthlyRate: +rate })}>更新月租</button>
            <button type="button" className="btn-secondary" onClick={() => saveLocker({ active: !l.active })}>{l.active ? '停用' : '啟用'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function BulkForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ prefix: 'A', from: '1', to: '20', digits: '2', size: '', monthlyRate: '300' });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await api.post('/lockers/bulk', { prefix: f.prefix, from: +f.from, to: +f.to, digits: +f.digits, size: f.size || undefined, monthlyRate: +f.monthlyRate });
    alert(`已新增 ${r.data.created} 個置物櫃（重複的櫃號會略過）`);
    onSaved();
  }
  const sample = `${f.prefix}${String(+f.from || 0).padStart(+f.digits || 1, '0')} ~ ${f.prefix}${String(+f.to || 0).padStart(+f.digits || 1, '0')}`;
  return (
    <Modal title="新增置物櫃" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="前綴"><input className="input" value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></Field>
          <Field label="從"><input type="number" min={0} className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="到"><input type="number" min={0} className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="位數"><input type="number" min={1} max={4} className="input" value={f.digits} onChange={(e) => setF({ ...f, digits: e.target.value })} /></Field>
          <Field label="尺寸"><input className="input" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="大／小" /></Field>
          <Field label="月租"><input type="number" min={0} className="input" value={f.monthlyRate} onChange={(e) => setF({ ...f, monthlyRate: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-gray-500">將建立 {sample}</p>
        <button className="btn-primary w-full">建立</button>
      </form>
    </Modal>
  );
}
