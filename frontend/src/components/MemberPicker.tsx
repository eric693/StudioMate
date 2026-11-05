import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../api/client';

export interface PickedMember { id: string; name: string; phone: string }

/** 搜尋並選擇會員（姓名或電話） */
export default function MemberPicker({ value, onChange, exclude, placeholder = '搜尋會員姓名或電話' }: {
  value: PickedMember | null; onChange: (m: PickedMember | null) => void; exclude?: string; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PickedMember[]>([]);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const t = setTimeout(() => api.get('/members', { params: { q, status: 'ACTIVE' } }).then((r) => setFound(r.data.filter((m: PickedMember) => m.id !== exclude).slice(0, 6))), 250);
    return () => clearTimeout(t);
  }, [q, exclude]);
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
        <span className="flex-1 text-gray-800">{value.name}<span className="text-gray-400 ml-2">{value.phone}</span></span>
        <button type="button" onClick={() => onChange(null)} aria-label="重新選擇"><X className="w-4 h-4 text-gray-400" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {found.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
          {found.map((m) => (
            <button type="button" key={m.id} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50" onClick={() => { onChange(m); setQ(''); }}>
              {m.name}<span className="text-gray-400 ml-2">{m.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 頁籤切換（各頁共用） */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
      {tabs.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} className={`px-4 py-1.5 rounded-lg text-sm whitespace-nowrap ${value === k ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}>{l}</button>
      ))}
    </div>
  );
}
