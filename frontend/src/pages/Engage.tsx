// 行銷頁的新頁籤：公告、滿意度問卷、自動行銷（生日、久未到訪）
import { useEffect, useState } from 'react';
import { Pin, Trash2, BarChart3, Plus, X } from 'lucide-react';
import api from '../api/client';
import Modal, { Field } from '../components/Modal';
import { Studio } from '../types';
import { dateStr, dateTime, localDay } from '../lib/format';

interface Announcement { id: string; title: string; body: string; pinned: boolean; expiresAt: string | null; pushed: number; createdAt: string }

export function Announcements() {
  const [list, setList] = useState<Announcement[]>([]);
  const [f, setF] = useState({ title: '', body: '', pinned: false, expiresAt: '', push: false });
  const load = () => api.get('/announcements').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.push && !confirm('同時用 LINE 推播給所有已綁定的會員？')) return;
    await api.post('/announcements', { ...f, expiresAt: f.expiresAt || null });
    setF({ title: '', body: '', pinned: false, expiresAt: '', push: false }); load();
  }
  async function toggle(a: Announcement) { await api.put(`/announcements/${a.id}`, { pinned: !a.pinned }); load(); }
  async function remove(a: Announcement) { if (!confirm(`刪除公告「${a.title}」？`)) return; await api.delete(`/announcements/${a.id}`); load(); }
  return (
    <div className="grid md:grid-cols-2 gap-4 items-start">
      <form onSubmit={submit} className="card space-y-3">
        <h2 className="font-semibold text-gray-700">發布公告</h2>
        <Field label="標題"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required placeholder="例如：國慶連假停課" /></Field>
        <Field label="內容"><textarea className="input min-h-[7rem]" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required /></Field>
        <Field label="顯示到（選填）" hint="過了這天會員端就不再顯示"><input type="date" className="input" min={localDay()} value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />置頂</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.push} onChange={(e) => setF({ ...f, push: e.target.checked })} />同時用 LINE 推播</label>
        <button className="btn-primary w-full">發布</button>
      </form>
      <div className="space-y-2">
        {list.length === 0 && <div className="card text-sm text-gray-400">還沒有公告。公告會顯示在會員手機網頁的首頁。</div>}
        {list.map((a) => {
          const expired = a.expiresAt && dateStr(a.expiresAt) < localDay();
          return (
            <div key={a.id} className={`card ${expired ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800">{a.pinned && <Pin className="w-3.5 h-3.5 inline text-brand mr-1" />}{a.title}</div>
                  <div className="text-xs text-gray-400">{dateTime(a.createdAt)}{a.expiresAt ? `・顯示到 ${dateStr(a.expiresAt)}` : ''}{a.pushed ? `・已推播 ${a.pushed} 人` : ''}{expired ? '・已過期' : ''}</div>
                </div>
                <button className="text-xs text-gray-500" onClick={() => toggle(a)}>{a.pinned ? '取消置頂' : '置頂'}</button>
                <button onClick={() => remove(a)} aria-label="刪除"><Trash2 className="w-4 h-4 text-gray-300 hover:text-red-500" /></button>
              </div>
              <p className="text-sm text-gray-600 whitespace-pre-wrap mt-2">{a.body}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type QType = 'rating' | 'text' | 'choice';
interface Question { id: string; type: QType; label: string; options?: string[] }
interface Survey { id: string; title: string; questions: Question[]; active: boolean; afterClass: boolean; createdAt: string; _count: { responses: number } }

export function Surveys() {
  const [list, setList] = useState<Survey[]>([]);
  const [edit, setEdit] = useState(false);
  const [results, setResults] = useState<Survey | null>(null);
  const load = () => api.get('/surveys').then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  async function toggle(s: Survey) { await api.put(`/surveys/${s.id}`, { active: !s.active }); load(); }
  async function remove(s: Survey) { if (!confirm(`刪除問卷「${s.title}」與所有回覆？`)) return; await api.delete(`/surveys/${s.id}`); load(); }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-500 flex-1">會員在手機網頁「我的」頁填寫。「下課問卷」會在下課後用 LINE 邀請當堂出席的會員評分，可以看出各教練的滿意度。</p>
        <button className="btn-primary" onClick={() => setEdit(true)}>新增問卷</button>
      </div>
      <div className="card p-0 overflow-hidden divide-y divide-gray-50">
        {list.length === 0 && <p className="text-sm text-gray-400 p-4">還沒有問卷。</p>}
        {list.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="flex-1 min-w-[12rem]">
              <div className="text-gray-800">{s.title}{s.afterClass && <span className="text-[11px] bg-brand/10 text-brand px-1.5 rounded-full ml-2">下課問卷</span>}{!s.active && <span className="text-[11px] bg-gray-100 text-gray-400 px-1.5 rounded-full ml-2">已停用</span>}</div>
              <div className="text-xs text-gray-400">{s.questions.length} 題・{s._count.responses} 份回覆</div>
            </div>
            <button className="btn-secondary text-xs py-1 flex items-center gap-1" onClick={() => setResults(s)}><BarChart3 className="w-3.5 h-3.5" />結果</button>
            <button className="text-xs text-gray-500" onClick={() => toggle(s)}>{s.active ? '停用' : '啟用'}</button>
            <button onClick={() => remove(s)} aria-label="刪除"><Trash2 className="w-4 h-4 text-gray-300 hover:text-red-500" /></button>
          </div>
        ))}
      </div>
      {edit && <SurveyForm onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
      {results && <SurveyResults s={results} onClose={() => setResults(null)} />}
    </div>
  );
}

const TEMPLATE: Question[] = [
  { id: 'q1', type: 'rating', label: '整體滿意度' },
  { id: 'q2', type: 'rating', label: '教練教學' },
  { id: 'q3', type: 'text', label: '想對我們說的話' },
];

function SurveyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [afterClass, setAfterClass] = useState(true);
  const [qs, setQs] = useState<Question[]>(TEMPLATE);
  const setQ = (i: number, patch: Partial<Question>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/surveys', { title, afterClass, questions: qs.map((q) => ({ ...q, options: q.type === 'choice' ? (q.options ?? []).filter(Boolean) : undefined })) });
    onSaved();
  }
  return (
    <Modal title="新增問卷" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        <Field label="問卷名稱"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="例如：上課滿意度" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={afterClass} onChange={(e) => setAfterClass(e.target.checked)} />下課問卷（每堂課結束後邀請出席會員評分）</label>
        <div className="space-y-2">
          {qs.map((q, i) => (
            <div key={q.id} className="rounded-xl border border-gray-100 p-3 space-y-2">
              <div className="flex gap-2">
                <select className="input w-28" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QType, options: e.target.value === 'choice' ? ['', ''] : undefined })} aria-label="題型">
                  <option value="rating">1–5 分</option><option value="choice">單選</option><option value="text">文字</option>
                </select>
                <input className="input" value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="題目" required />
                <button type="button" onClick={() => setQs(qs.filter((_, j) => j !== i))} aria-label="刪除題目"><X className="w-4 h-4 text-gray-400" /></button>
              </div>
              {q.type === 'choice' && (
                <div className="flex flex-wrap gap-2 pl-[7.5rem]">
                  {(q.options ?? []).map((o, k) => <input key={k} className="input w-32" value={o} onChange={(e) => setQ(i, { options: q.options!.map((x, m) => (m === k ? e.target.value : x)) })} placeholder={`選項 ${k + 1}`} />)}
                  <button type="button" className="text-xs text-brand" onClick={() => setQ(i, { options: [...(q.options ?? []), ''] })}>＋選項</button>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="text-sm text-brand flex items-center gap-1" onClick={() => setQs([...qs, { id: `q${Date.now().toString(36)}`, type: 'rating', label: '' }])}><Plus className="w-4 h-4" />新增題目</button>
        </div>
        <button className="btn-primary w-full" disabled={!qs.length}>建立問卷</button>
      </form>
    </Modal>
  );
}

interface Result {
  total: number;
  questions: (Question & { count: number; average?: number | null; distribution?: number[]; byCoach?: { coach: string; average: number; count: number }[]; counts?: { option: string; count: number }[]; texts?: { text: string; member: string; at: string }[] })[];
}

function SurveyResults({ s, onClose }: { s: Survey; onClose: () => void }) {
  const [r, setR] = useState<Result | null>(null);
  useEffect(() => { api.get(`/surveys/${s.id}/results`).then((x) => setR(x.data)); }, [s.id]);
  return (
    <Modal title={`${s.title}・結果`} onClose={onClose} wide>
      {!r ? <p className="text-sm text-gray-400">載入中…</p> : r.total === 0 ? <p className="text-sm text-gray-400">還沒有人填寫。</p> : (
        <div className="space-y-5">
          <p className="text-sm text-gray-500">共 {r.total} 份回覆</p>
          {r.questions.map((q) => (
            <div key={q.id} className="space-y-2">
              <div className="text-sm font-medium text-gray-800">{q.label}<span className="text-xs text-gray-400 ml-2">{q.count} 人回答</span></div>
              {q.type === 'rating' && (
                <>
                  <div className="text-3xl font-bold text-brand">{q.average ?? '—'}<span className="text-sm text-gray-400"> / 5</span></div>
                  <div className="space-y-1">
                    {[5, 4, 3, 2, 1].map((k) => {
                      const n = q.distribution![k - 1], max = Math.max(1, ...q.distribution!);
                      return <div key={k} className="flex items-center gap-2 text-xs"><span className="w-6 text-gray-500">{k} 分</span><div className="flex-1 h-2 bg-gray-100 rounded-full"><div className="h-full bg-brand rounded-full" style={{ width: `${(n / max) * 100}%` }} /></div><span className="w-6 text-right text-gray-500 tabular-nums">{n}</span></div>;
                    })}
                  </div>
                  {!!q.byCoach?.length && <div className="flex flex-wrap gap-2 text-xs">{q.byCoach.map((c) => <span key={c.coach} className="bg-gray-100 rounded-full px-2 py-0.5">{c.coach} {c.average}（{c.count}）</span>)}</div>}
                </>
              )}
              {q.type === 'choice' && q.counts!.map((c) => <div key={c.option} className="flex justify-between text-sm text-gray-600"><span>{c.option}</span><span className="tabular-nums">{c.count}</span></div>)}
              {q.type === 'text' && <div className="space-y-1 max-h-48 overflow-y-auto">{q.texts!.map((t, i) => <div key={i} className="text-sm bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-700">{t.text}</span><span className="text-xs text-gray-400 ml-2">— {t.member}</span></div>)}</div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** 自動行銷：生日祝福與久未到訪喚回，每天早上 10 點自動發送 LINE */
export function Automations() {
  const [s, setS] = useState<Studio | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/studio').then((r) => setS(r.data)); }, []);
  if (!s) return <div className="text-sm text-gray-400">載入中…</div>;
  const set = (patch: Partial<Studio>) => setS({ ...s, ...patch });
  async function save() {
    await api.put('/studio', {
      birthdayEnabled: s!.birthdayEnabled, birthdayMessage: s!.birthdayMessage || null, birthdayCoupon: s!.birthdayCoupon,
      winbackEnabled: s!.winbackEnabled, winbackDays: s!.winbackDays, winbackMessage: s!.winbackMessage || null, winbackCoupon: s!.winbackCoupon,
    });
    setMsg('已儲存'); setTimeout(() => setMsg(''), 2500);
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">每天早上 10 點自動用 LINE 發送。訊息中的 {'{name}'} 會換成會員姓名、{'{studio}'} 換成教室名稱。設定折價券金額時會同時發一張會員專屬的折價券（限用一次）。</p>
      <div className="card space-y-3">
        <label className="flex items-center gap-2 font-medium text-gray-700"><input type="checkbox" checked={s.birthdayEnabled} onChange={(e) => set({ birthdayEnabled: e.target.checked })} />生日祝福</label>
        <Field label="訊息"><textarea className="input" value={s.birthdayMessage ?? ''} onChange={(e) => set({ birthdayMessage: e.target.value })} placeholder="{name} 生日快樂！{studio} 祝您新的一歲健康有活力。" /></Field>
        <Field label="生日折價券金額（0＝不送，30 天內有效）"><input type="number" min={0} className="input w-40" value={s.birthdayCoupon} onChange={(e) => set({ birthdayCoupon: +e.target.value })} /></Field>
      </div>
      <div className="card space-y-3">
        <label className="flex items-center gap-2 font-medium text-gray-700"><input type="checkbox" checked={s.winbackEnabled} onChange={(e) => set({ winbackEnabled: e.target.checked })} />久未到訪喚回</label>
        <Field label="幾天沒來上課就發送" hint="超過這個天數的三倍仍未回來的會員不再打擾；回來上課後再次久未到訪會再發一次"><input type="number" min={7} max={365} className="input w-40" value={s.winbackDays} onChange={(e) => set({ winbackDays: +e.target.value })} /></Field>
        <Field label="訊息"><textarea className="input" value={s.winbackMessage ?? ''} onChange={(e) => set({ winbackMessage: e.target.value })} placeholder="{name} 好久不見！{studio} 想念您，最近有新課程，歡迎回來上課。" /></Field>
        <Field label="回娘家折價券金額（0＝不送，14 天內有效）"><input type="number" min={0} className="input w-40" value={s.winbackCoupon} onChange={(e) => set({ winbackCoupon: +e.target.value })} /></Field>
      </div>
      <div className="flex items-center gap-3"><button className="btn-primary" onClick={save}>儲存</button>{msg && <span className="text-sm text-green-600">{msg}</span>}</div>
    </div>
  );
}
