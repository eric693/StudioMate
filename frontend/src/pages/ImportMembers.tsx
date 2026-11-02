import { useState } from 'react';
import { Download } from 'lucide-react';
import api from '../api/client';
import Modal from '../components/Modal';

// 欄位名稱：接受中文標題（本系統匯出的格式）或英文
const COLUMNS: Record<string, string[]> = {
  name: ['姓名', 'name'], phone: ['電話', '手機', 'phone'], email: ['email', 'Email', '電子郵件'], birthday: ['生日', 'birthday'],
  note: ['備註', 'note'], planName: ['方案', '有效方案', 'planName'], creditsLeft: ['剩餘堂數', 'creditsLeft'], endDate: ['到期日', 'endDate'],
};
const TEMPLATE = '姓名,電話,Email,生日,備註,方案,剩餘堂數,到期日\n王小明,0912345678,ming@example.com,1990-05-01,,10 堂卡,6,2027-01-31\n林怡君,0922333444,,,膝蓋舊傷,,,\n';

/** 解析 CSV（支援引號、逗號與換行在引號內、UTF-8 BOM） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Excel 常把日期存成 2027/1/31，統一成 YYYY-MM-DD */
const normDate = (v: string) => {
  const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(v.trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : v.trim();
};

interface Result { row: number; name?: string; action?: string; error?: string; pass?: string }

export default function ImportMembers({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [preview, setPreview] = useState<{ ok: number; errors: number; results: Result[] } | null>(null);
  const [done, setDone] = useState<{ created: number; updated: number; passes: number; errors: number; results: Result[] } | null>(null);
  const [err, setErr] = useState('');

  async function pick(file: File) {
    setErr(''); setPreview(null); setDone(null);
    const text = await file.text();
    const [header, ...body] = parseCsv(text);
    if (!header) { setErr('檔案是空的'); return; }
    const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h.trim()))]));
    if (idx.name < 0 || idx.phone < 0) { setErr('找不到「姓名」與「電話」欄位，請使用範本的標題列'); return; }
    const data = body.map((r) => Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([k, i]) => [k, ['birthday', 'endDate'].includes(k) ? normDate(r[i] ?? '') : (r[i] ?? '').trim()])));
    setRows(data);
    const p = await api.post('/members/import', { rows: data, dryRun: true });
    setPreview(p.data);
  }
  async function run() {
    const r = await api.post('/members/import', { rows });
    setDone(r.data);
  }
  function template() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv' }));
    a.download = '會員匯入範本.csv'; a.click();
  }

  return (
    <Modal title="匯入會員" onClose={done ? onDone : onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">從 Excel 或舊系統匯入會員。請另存為 CSV（UTF-8）後上傳。電話已存在的會員會更新資料，不會重複建立。</p>
        <ul className="text-xs text-gray-500 list-disc pl-5 space-y-0.5">
          <li>必填：姓名、電話。選填：Email、生日、備註</li>
          <li>要一併帶入剩餘堂數：填「方案」（需與「方案與課程」中的名稱相同）、「剩餘堂數」、「到期日」。匯入的方案金額記為 0，不計入營收</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary flex items-center gap-1" onClick={template}><Download className="w-4 h-4" />下載範本</button>
          <label className="btn-primary cursor-pointer">選擇 CSV 檔<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} /></label>
        </div>
        {err && <div className="text-red-500">{err}</div>}
        {preview && !done && (
          <div className="space-y-2">
            <div className="text-gray-700">共 {rows?.length} 列：<span className="text-green-600">{preview.ok} 列可匯入</span>{preview.errors ? <span className="text-red-500">、{preview.errors} 列有問題（會略過）</span> : ''}</div>
            <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
              {preview.results.map((r) => (
                <div key={r.row} className="px-3 py-1.5 flex gap-2 text-xs">
                  <span className="text-gray-400 w-12">第 {r.row} 列</span>
                  <span className="text-gray-700 w-24 truncate">{r.name}</span>
                  {r.error ? <span className="text-red-500">{r.error}</span> : <span className="text-gray-500">{r.action === 'update' ? '更新既有會員' : '新增'}{r.pass ? `・${r.pass}` : ''}</span>}
                </div>
              ))}
            </div>
            <button className="btn-primary w-full" disabled={!preview.ok} onClick={run}>匯入 {preview.ok} 位會員</button>
          </div>
        )}
        {done && (
          <div className="space-y-2">
            <div className="bg-green-50 text-green-700 rounded-xl px-3 py-2">完成：新增 {done.created} 位、更新 {done.updated} 位、帶入方案 {done.passes} 筆{done.errors ? `，略過 ${done.errors} 列` : ''}</div>
            <button className="btn-primary w-full" onClick={onDone}>完成</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
