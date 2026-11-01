import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, ShieldCheck, UserCog, KeyRound } from 'lucide-react';
import api from '../api/client';
import HowTo from '../components/HowTo';
import SearchBox, { matches } from '../components/SearchBox';
import { useAuth } from '../context/AuthContext';
import { isAdmin } from '../lib/permissions';
import { User } from '../types';

interface Module { key: string; label: string }

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback;

export default function Accounts() {
  const { user, refresh } = useAuth();
  const admin = isAdmin(user);
  const [staff, setStaff] = useState<User[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(admin);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [toast, setToast] = useState('');

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function load() {
    if (!admin) return;
    setLoading(true);
    Promise.all([api.get('/users'), api.get('/users/modules')])
      .then(([u, m]) => { setStaff(u.data.staff); setModules(m.data); })
      .finally(() => setLoading(false));
  }
  useEffect(load, [admin]);

  async function toggleActive(u: User) {
    await api.put(`/users/${u.id}`, { active: !u.active });
    flash(u.active ? `已停用 ${u.name}` : `已啟用 ${u.name}`);
    load();
  }

  async function remove(u: User) {
    if (!confirm(`確定刪除帳號「${u.name}（${u.email}）」？刪除後無法登入，也無法復原。`)) return;
    await api.delete(`/users/${u.id}`);
    flash('已刪除');
    load();
  }

  const moduleLabel = (k: string) => modules.find((m) => m.key === k)?.label.replace(/（.*）/, '') ?? k;
  const shown = staff.filter((u) =>
    (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? u.active : !u.active))
    && matches(search, u.name, u.email, ...(u.permissions ?? []).map(moduleLabel)));

  return (
    <div className="px-6 py-6 max-w-4xl relative">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-xl shadow-lg">{toast}</div>
      )}
      <div className="page-header items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">帳號權限</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {admin ? '建立員工的登入帳號密碼，並設定每個人能使用哪些功能' : '修改您的登入帳號與密碼'}
          </p>
        </div>
        {admin && (
          <button onClick={() => setEditing('new')} className="btn-primary text-sm flex items-center gap-1.5">
            <Plus className="w-4 h-4" />新增帳號
          </button>
        )}
      </div>

      <HowTo module="accounts" />

      <MyAccount onSaved={() => { refresh(); flash('已更新您的帳號'); }} />

      {admin && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700 mr-auto flex items-center gap-1.5">
              <UserCog className="w-4 h-4 text-brand" />員工帳號（{staff.length}）
            </h2>
            <div className="flex gap-1 bg-white rounded-xl p-1 border border-gray-100">
              {([['ALL', '全部'], ['ACTIVE', '啟用中'], ['DISABLED', '已停用']] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setStatusFilter(k)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${statusFilter === k ? 'bg-brand text-white' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <SearchBox value={search} onChange={setSearch} placeholder="搜尋姓名、帳號、權限" />
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-12 text-sm">載入中...</div>
          ) : shown.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 text-center py-12 text-gray-400 text-sm">
              {staff.length === 0 ? '還沒有員工帳號，按右上角「新增帳號」建立' : '沒有符合條件的帳號'}
            </div>
          ) : (
            <div className="space-y-2">
              {shown.map((u) => (
                <div key={u.id} className={`bg-white rounded-2xl border border-gray-100 p-4 ${u.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold shrink-0">
                      {u.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">{u.name}</span>
                        <span className="text-xs text-gray-400">帳號：{u.email}</span>
                        {!u.active && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">已停用</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(u.permissions ?? []).length === 0 ? (
                          <span className="text-xs text-orange-500">尚未開放任何功能</span>
                        ) : (
                          (u.permissions ?? []).map((k) => (
                            <span key={k} className="text-xs bg-brand/5 text-brand px-2 py-0.5 rounded-full">{moduleLabel(k)}</span>
                          ))
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        最後登入：{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-TW') : '尚未登入'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleActive(u)} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50">
                        {u.active ? '停用' : '啟用'}
                      </button>
                      <button onClick={() => setEditing(u)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="編輯">
                        <Pencil className="w-4 h-4 text-gray-500" />
                      </button>
                      <button onClick={() => remove(u)} className="p-1.5 rounded-lg hover:bg-red-50" aria-label="刪除">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {editing && (
        <StaffForm
          user={editing === 'new' ? undefined : editing}
          modules={modules}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); flash(msg); load(); }}
        />
      )}
    </div>
  );
}

/** 自己的帳號：改名稱、登入帳號、密碼 */
function MyAccount({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.name ?? '', email: user?.email ?? '', currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState('');
  // 密碼欄預設收起：iPhone Safari 會自動把「建議的高強度密碼」填進新密碼欄，
  // 使用者沒注意就存下去，密碼就被換成自己不知道的值。要改密碼時才展開。
  const [changePw, setChangePw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const pwType = showPw ? 'text' : 'password';
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const needCurrent = form.email.trim().toLowerCase() !== user?.email || (changePw && !!form.newPassword);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDone('');
    if (changePw && form.newPassword !== form.confirm) { setError('兩次輸入的新密碼不一樣'); return; }
    if (changePw && form.newPassword.length < 6) { setError('新密碼至少 6 碼'); return; }
    setSaving(true);
    try {
      await api.put('/auth/me', {
        name: form.name, email: form.email,
        currentPassword: form.currentPassword || undefined,
        newPassword: changePw ? form.newPassword : undefined,
      });
      setForm((f) => ({ ...f, currentPassword: '', newPassword: '', confirm: '' }));
      setDone(changePw
        ? '已儲存。密碼已經改成您剛才輸入的新密碼，之後登入與驗證請用新密碼。'
        : '已儲存。');
      setChangePw(false);
      onSaved();
    } catch (err) {
      setError(errMsg(err, '儲存失敗'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
        <KeyRound className="w-4 h-4 text-brand" />我的帳號
        <span className="text-xs font-normal text-gray-400 ml-1">{isAdmin(user) ? '管理員' : '員工'}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs text-gray-500">名稱
          <input className="input mt-1" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="block text-xs text-gray-500">登入帳號（Email 或自訂帳號）
          <input className="input mt-1" autoCapitalize="none" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </label>
        <div className="sm:col-span-2 flex items-center gap-4 text-sm text-gray-600">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-brand"
              checked={changePw}
              onChange={(e) => { setChangePw(e.target.checked); setForm((f) => ({ ...f, newPassword: '', confirm: '' })); }}
            />
            我要修改密碼
          </label>
          {(changePw || needCurrent) && (
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" className="accent-brand" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
              顯示密碼
            </label>
          )}
        </div>
        {changePw && (
          <>
            <label className="block text-xs text-gray-500">新密碼（至少 6 碼）
              <input type={pwType} autoCapitalize="none" autoCorrect="off" autoComplete="new-password" className="input mt-1" value={form.newPassword} onChange={(e) => set('newPassword', e.target.value)} required />
            </label>
            <label className="block text-xs text-gray-500">再輸入一次新密碼
              <input type={pwType} autoCapitalize="none" autoCorrect="off" autoComplete="new-password" className="input mt-1" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} required />
            </label>
          </>
        )}
        {needCurrent && (
          <label className="block text-xs text-gray-500 sm:col-span-2">目前密碼（修改帳號或密碼需驗證）
            <input type={pwType} autoCapitalize="none" autoCorrect="off" autoComplete="current-password" className="input mt-1" value={form.currentPassword} onChange={(e) => set('currentPassword', e.target.value)} required />
          </label>
        )}
      </div>
      {error && <div className="text-xs text-red-500 mt-2">{error}</div>}
      {done && <div className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 mt-2">{done}</div>}
      <div className="flex justify-end mt-3">
        <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? '儲存中…' : '儲存'}</button>
      </div>
    </form>
  );
}

function StaffForm({ user, modules, onClose, onSaved }: {
  user?: User; modules: Module[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    permissions: user?.permissions ?? ['dashboard', 'finance'],
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function toggle(k: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(k) ? f.permissions.filter((x) => x !== k) : [...f.permissions, k],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (user) {
        await api.put(`/users/${user.id}`, { ...form, password: form.password || undefined });
        onSaved('已更新帳號');
      } else {
        await api.post('/users', form);
        onSaved(`已建立帳號「${form.email}」`);
      }
    } catch (err) {
      setError(errMsg(err, '儲存失敗'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">{user ? '編輯員工帳號' : '新增員工帳號'}</h2>
          <button type="button" onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-xs text-gray-500">姓名
            <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="block text-xs text-gray-500">登入帳號（自訂，例如 staff01 或 Email）
            <input className="input mt-1" autoCapitalize="none" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required minLength={3} />
          </label>
          <label className="block text-xs text-gray-500">{user ? '重設密碼（不改請留空）' : '密碼（至少 6 碼）'}
            <input
              type="text"
              autoComplete="new-password"
              className="input mt-1"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!user}
              minLength={6}
            />
          </label>
          <div>
            <div className="text-xs text-gray-500 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-brand" />可使用的功能</span>
              <span className="flex gap-2">
                <button type="button" className="text-brand" onClick={() => setForm({ ...form, permissions: modules.map((m) => m.key) })}>全選</button>
                <button type="button" className="text-gray-400" onClick={() => setForm({ ...form, permissions: [] })}>全不選</button>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {modules.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700 bg-warm rounded-lg px-3 py-2 cursor-pointer">
                  <input type="checkbox" className="accent-brand" checked={form.permissions.includes(m.key)} onChange={() => toggle(m.key)} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button type="button" onClick={onClose} className="flex-1 text-sm border border-gray-200 rounded-xl py-2">取消</button>
          <button type="submit" disabled={saving} className="flex-1 text-sm bg-brand text-white rounded-xl py-2 font-medium disabled:opacity-50">
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </form>
    </div>
  );
}
