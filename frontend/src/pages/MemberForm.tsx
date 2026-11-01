import { useState } from 'react';
import api from '../api/client';
import Modal, { Field } from '../components/Modal';
import { Member } from '../types';
import { dateStr } from '../lib/format';

export default function MemberForm({ member, onClose, onSaved }: { member?: Member; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: member?.name ?? '', phone: member?.phone ?? '', email: member?.email ?? '', birthday: dateStr(member?.birthday),
    emergencyContact: member?.emergencyContact ?? '', note: member?.note ?? '', status: member?.status ?? 'ACTIVE',
  });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (member) await api.put(`/members/${member.id}`, f); else await api.post('/members', f);
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
        {member && <Field label="狀態"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="ACTIVE">使用中</option><option value="INACTIVE">停用</option></select></Field>}
        <button className="btn-primary w-full">儲存</button>
      </form>
    </Modal>
  );
}
