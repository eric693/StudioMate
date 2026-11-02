import { useState } from 'react';
import api from '../api/client';
import Modal, { Field } from '../components/Modal';
import { Member } from '../types';
import { CARRIER, dateStr } from '../lib/format';

export default function MemberForm({ member, onClose, onSaved }: { member?: Member; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: member?.name ?? '', phone: member?.phone ?? '', email: member?.email ?? '', birthday: dateStr(member?.birthday),
    emergencyContact: member?.emergencyContact ?? '', note: member?.note ?? '', status: member?.status ?? 'ACTIVE',
    referrerCode: '', invoiceCarrierType: member?.invoiceCarrierType ?? '', invoiceCarrierNum: member?.invoiceCarrierNum ?? '',
    invoiceTaxId: member?.invoiceTaxId ?? '', invoiceTitle: member?.invoiceTitle ?? '',
  });
  const [more, setMore] = useState(Boolean(member?.invoiceCarrierType));
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { referrerCode, ...rest } = f;
    const body = { ...rest, ...(referrerCode ? { referrerCode } : {}), invoiceCarrierNum: f.invoiceCarrierNum || null, invoiceTitle: f.invoiceTitle || null };
    if (member) await api.put(`/members/${member.id}`, body); else await api.post('/members', body);
    onSaved();
  }
  return (
    <Modal title={member ? '編輯會員' : '新增會員'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓名"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label="手機"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input type="email" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="生日"><input type="date" className="input" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} /></Field>
        </div>
        <Field label="緊急聯絡人"><input className="input" value={f.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} placeholder="姓名、關係、電話" /></Field>
        <Field label="備註"><textarea className="input" rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="例如：膝蓋舊傷、懷孕中" /></Field>
        {!member?.referredById && <Field label="介紹人推薦碼" hint="選填；被介紹的新會員首次購買後，介紹人會獲得折價券"><input className="input font-mono uppercase" value={f.referrerCode} onChange={(e) => set('referrerCode', e.target.value.toUpperCase())} placeholder="例如 R7K3PQ" /></Field>}
        <button type="button" className="text-xs text-brand" onClick={() => setMore(!more)}>{more ? '收起' : '＋ 發票載具設定'}</button>
        {more && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="發票載具"><select className="input" value={f.invoiceCarrierType} onChange={(e) => set('invoiceCarrierType', e.target.value)}>{Object.entries(CARRIER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {['MOBILE', 'CITIZEN', 'DONATE'].includes(f.invoiceCarrierType) && <Field label={f.invoiceCarrierType === 'DONATE' ? '愛心碼' : '載具號碼'}><input className="input font-mono" value={f.invoiceCarrierNum} onChange={(e) => set('invoiceCarrierNum', e.target.value)} placeholder={f.invoiceCarrierType === 'MOBILE' ? '/ABC1234' : ''} /></Field>}
            {f.invoiceCarrierType === 'COMPANY' && <>
              <Field label="統一編號"><input className="input font-mono" value={f.invoiceTaxId} onChange={(e) => set('invoiceTaxId', e.target.value)} maxLength={8} /></Field>
              <Field label="公司抬頭"><input className="input" value={f.invoiceTitle} onChange={(e) => set('invoiceTitle', e.target.value)} /></Field>
            </>}
          </div>
        )}
        {member && <Field label="狀態"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="ACTIVE">使用中</option><option value="INACTIVE">停用</option></select></Field>}
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}
