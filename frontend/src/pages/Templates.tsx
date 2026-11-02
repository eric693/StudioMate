import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import SearchBox, { matches } from '../components/SearchBox';
import Modal, { Field } from '../components/Modal';
import { Branch, ClassType, Coach, Template } from '../types';
import { WEEKDAYS, dateStr } from '../lib/format';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // 週一排最前面

export default function Templates() {
  const [list, setList] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [typeId, setTypeId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [weekday, setWeekday] = useState('');
  const load = () => api.get('/templates').then((r) => setList(r.data));
  const uniq = <T extends { id: string }>(a: (T | null)[]) => [...new Map(a.filter(Boolean).map((x) => [x!.id, x!])).values()];
  const typeOpts = uniq(list.map((t) => t.classType));
  const coachOpts = uniq(list.map((t) => t.coach));
  const branchOpts = uniq(list.map((t) => t.branch));
  const [branchId, setBranchId] = useState('');
  const shown = list.filter((t) => matches(q, t.classType.name, t.coach?.name, t.room, t.startTime)
    && (!typeId || t.classTypeId === typeId) && (!coachId || t.coachId === coachId) && (weekday === '' || t.weekday === +weekday)
    && (!branchId || t.branchId === branchId));
  useEffect(() => { load(); }, []);

  async function remove(t: Template) {
    if (!confirm(`刪除「週${WEEKDAYS[t.weekday]} ${t.startTime} ${t.classType.name}」？\n未來還沒有人預約的課程會一併移除。`)) return;
    const r = await api.delete(`/templates/${t.id}`);
    setMsg(`已刪除，移除 ${r.data.removed} 堂未來課程${r.data.kept ? `；${r.data.kept} 堂已有人預約的課程保留，請到課表個別處理` : ''}`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <div>
          <h1 className="text-xl font-bold text-gray-800">固定課表</h1>
          <p className="text-sm text-gray-400">每週重複的課程，系統會自動產生未來的課表</p>
        </div>
        <div><button className="btn-primary flex items-center gap-1" onClick={() => setEditing('new')}><Plus className="w-4 h-4" />新增固定課程</button></div>
      </div>
      <HowTo module="templates" />
      {list.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <SearchBox value={q} onChange={setQ} placeholder="搜尋課程、教練、教室、時間" />
          <select className="input w-auto text-sm" value={weekday} onChange={(e) => setWeekday(e.target.value)} aria-label="星期">
            <option value="">每天</option>{ORDER.map((w) => <option key={w} value={w}>星期{WEEKDAYS[w]}</option>)}
          </select>
          <select className="input w-auto text-sm" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="課程類型">
            <option value="">全部課程</option>{typeOpts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="input w-auto text-sm" value={coachId} onChange={(e) => setCoachId(e.target.value)} aria-label="教練">
            <option value="">全部教練</option>{coachOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {branchOpts.length > 0 && <select className="input w-auto text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="分店">
            <option value="">全部分店</option>{branchOpts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>}
          {shown.length !== list.length && <span className="text-xs text-gray-400">符合 {shown.length} / {list.length} 堂</span>}
        </div>
      )}
      {msg && <div className="text-sm bg-green-50 text-green-700 rounded-xl px-3 py-2">{msg}</div>}

      {list.length === 0 ? <div className="card text-sm text-gray-400">還沒有固定課程。按右上角新增，例如「每週二 19:00 哈達瑜珈」。</div> : (
        shown.length === 0 ? <div className="card text-sm text-gray-400">沒有符合條件的固定課程。</div> :
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ORDER.map((wd) => {
            const rows = shown.filter((t) => t.weekday === wd);
            if (!rows.length) return null;
            return (
              <div key={wd} className="card">
                <div className="font-semibold text-gray-700 mb-2">星期{WEEKDAYS[wd]}</div>
                <div className="divide-y divide-gray-50">
                  {rows.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-2">
                      <span className="w-1.5 h-8 rounded-full" style={{ background: t.classType.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{t.startTime} {t.classType.name}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {t.coach?.name ?? '未指定教練'}・{t.durationMin} 分・{t.capacity} 人{t.room ? `・${t.room}` : ''}{t.branch ? `・${t.branch.name}` : ''}{t.liveUrl ? '・直播' : ''}
                          {t.activeTo ? `・至 ${dateStr(t.activeTo)}` : ''}
                        </div>
                      </div>
                      <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="編輯" onClick={() => setEditing(t)}><Pencil className="w-4 h-4 text-gray-400" /></button>
                      <button className="p-1.5 rounded-lg hover:bg-gray-50" aria-label="刪除" onClick={() => remove(t)}><Trash2 className="w-4 h-4 text-gray-400" /></button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <TemplateForm t={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(m) => { setEditing(null); setMsg(m); load(); }} />}
    </div>
  );
}

function TemplateForm({ t, onClose, onSaved }: { t: Template | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [types, setTypes] = useState<ClassType[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [f, setF] = useState({
    classTypeId: t?.classTypeId ?? '', coachId: t?.coachId ?? '', weekday: String(t?.weekday ?? 1), startTime: t?.startTime ?? '19:00',
    durationMin: String(t?.durationMin ?? ''), capacity: String(t?.capacity ?? ''), room: t?.room ?? '', activeTo: t?.activeTo ? dateStr(t.activeTo) : '',
    branchId: t?.branchId ?? '', liveUrl: t?.liveUrl ?? '',
  });
  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    api.get('/class-types').then((r) => { const a = r.data.filter((x: ClassType) => x.active || x.id === t?.classTypeId); setTypes(a); if (!t && a[0]) setF((x) => ({ ...x, classTypeId: a[0].id })); });
    api.get('/coaches').then((r) => setCoaches(r.data.filter((c: Coach) => c.active || c.id === t?.coachId)));
    api.get('/branches').then((r) => setBranches(r.data.filter((b: Branch) => b.active || b.id === t?.branchId)));
  }, [t]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const ct = types.find((x) => x.id === f.classTypeId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      classTypeId: f.classTypeId, coachId: f.coachId || null, weekday: +f.weekday, startTime: f.startTime,
      durationMin: f.durationMin ? +f.durationMin : undefined, capacity: f.capacity ? +f.capacity : undefined,
      room: f.room || null, activeTo: f.activeTo || null, branchId: f.branchId || null, liveUrl: f.liveUrl || null,
    };
    if (t) {
      const r = await api.put(`/templates/${t.id}`, body);
      onSaved(`已更新：重建 ${r.data.created} 堂未來課程${r.data.kept ? `；${r.data.kept} 堂已有人預約的課程維持原設定，請到課表個別調整` : ''}`);
    } else {
      const r = await api.post('/templates', body);
      onSaved(`已新增，自動產生 ${r.data.created} 堂課程`);
    }
  }
  return (
    <Modal title={t ? '編輯固定課程' : '新增固定課程'} onClose={onClose}>
      {types.length === 0 ? <p className="text-sm text-gray-500">請先到「方案與課程」建立課程類型。</p> : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="課程類型"><select className="input" value={f.classTypeId} onChange={(e) => set('classTypeId', e.target.value)}>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="星期"><select className="input" value={f.weekday} onChange={(e) => set('weekday', e.target.value)}>{ORDER.map((w) => <option key={w} value={w}>星期{WEEKDAYS[w]}</option>)}</select></Field>
            <Field label="開始時間"><input type="time" className="input" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} required /></Field>
          </div>
          <Field label="教練"><select className="input" value={f.coachId} onChange={(e) => set('coachId', e.target.value)}><option value="">未指定</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="時長（分鐘）"><input type="number" min={10} className="input" value={f.durationMin} placeholder={String(ct?.durationMin ?? 60)} onChange={(e) => set('durationMin', e.target.value)} /></Field>
            <Field label="名額"><input type="number" min={1} className="input" value={f.capacity} placeholder={String(ct?.defaultCapacity ?? 12)} onChange={(e) => set('capacity', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="教室"><input className="input" value={f.room} onChange={(e) => set('room', e.target.value)} placeholder="選填" /></Field>
            <Field label="結束日期" hint="空白＝持續開課"><input type="date" className="input" value={f.activeTo} onChange={(e) => set('activeTo', e.target.value)} /></Field>
          </div>
          {branches.length > 0 && <Field label="分店"><select className="input" value={f.branchId} onChange={(e) => set('branchId', e.target.value)}><option value="">不指定</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          {(ct?.isOnline || f.liveUrl) && <Field label="直播連結" hint="每堂課都使用這個連結；只有已預約的會員看得到"><input className="input" type="url" value={f.liveUrl} onChange={(e) => set('liveUrl', e.target.value)} placeholder="https://meet.google.com/..." /></Field>}
          <button className="btn-primary w-full">{t ? '儲存' : '新增並產生課程'}</button>
        </form>
      )}
    </Modal>
  );
}
