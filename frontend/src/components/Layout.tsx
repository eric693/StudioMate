import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { can, isAdmin } from '../lib/permissions';
import { setTimeZone } from '../lib/format';
import {
  LayoutDashboard, CalendarDays, Repeat, Users, Tags, BarChart3, Settings, ShieldCheck, Dumbbell, Menu, X, Building2, ShoppingBag, Megaphone, DoorOpen,
  Store, ScanLine, UserCog, Clock as ClockIcon,
} from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [studioName, setStudioName] = useState('');
  // 手機：側邊選單改為抽屜
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // 教室時區與名稱：所有時間都以教室所在時區顯示
  useEffect(() => {
    api.get('/studio').then((r) => { setTimeZone(r.data.timezone); setStudioName(r.data.name); }).catch(() => {});
  }, []);
  // 待審核的轉帳訂單數（顯示在選單上），切換頁面時更新
  const [pendingOrders, setPendingOrders] = useState(0);
  useEffect(() => {
    if (!can(user, 'members')) return;
    const refresh = () => api.get('/orders', { params: { status: 'PENDING', method: 'TRANSFER' } })
      .then((r) => setPendingOrders(r.data.filter((o: { transferLast5: string | null }) => o.transferLast5).length)).catch(() => {});
    refresh();
    window.addEventListener('orders-changed', refresh); // 訂單頁審核後立即更新數字
    return () => window.removeEventListener('orders-changed', refresh);
  }, [location.pathname, user]);

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <div className="flex h-screen h-[100dvh] bg-warm overflow-hidden">
      {menuOpen && <div className="md:hidden fixed inset-0 bg-black/40 z-[55]" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`${menuOpen ? 'fixed inset-y-0 left-0 z-[56] flex shadow-2xl pt-safe' : 'hidden'} md:static md:z-auto md:shadow-none md:pt-0 md:flex flex-col w-64 max-w-[80vw] md:w-56 bg-white border-r border-gray-100 flex-shrink-0`}
      >
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center flex-shrink-0">
              <Dumbbell className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-bold text-gray-800 text-sm leading-tight">StudioMate</div>
              <div className="text-xs text-gray-400">教室管家</div>
            </div>
            <button onClick={() => setMenuOpen(false)} className="md:hidden ml-auto p-1.5 rounded-lg hover:bg-gray-100" aria-label="關閉選單">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
        <div className="mx-3 mt-3 mb-1 bg-warm rounded-xl p-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs text-gray-400">教室</span>
            </div>
            <span className="text-xs bg-brand/10 text-brand px-1.5 py-0.5 rounded-full font-medium">{isAdmin(user) ? '管理員' : '員工'}</span>
          </div>
          <div className="font-semibold text-gray-700 text-sm truncate">{studioName || user?.name}</div>
          <div className="text-xs text-gray-400 truncate mt-0.5">{user?.name}・{user?.email}</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {can(user, 'dashboard') && <SidebarLink to="/" label="總覽" icon={LayoutDashboard} exact />}
          {can(user, 'schedule') && <SidebarLink to="/schedule" label="課表與點名" icon={CalendarDays} />}
          {can(user, 'schedule') && <SidebarLink to="/templates" label="固定課表" icon={Repeat} />}
          {can(user, 'members') && <SidebarLink to="/members" label="會員" icon={Users} />}
          {can(user, 'members') && <SidebarLink to="/orders" label="線上訂單" icon={ShoppingBag} badge={pendingOrders} />}
          {can(user, 'catalog') && <SidebarLink to="/catalog" label="方案與課程" icon={Tags} />}
          {can(user, 'marketing') && <SidebarLink to="/marketing" label="行銷" icon={Megaphone} />}
          {can(user, 'rentals') && <SidebarLink to="/rentals" label="場地與置物櫃" icon={DoorOpen} />}
          {can(user, 'pos') && <SidebarLink to="/pos" label="商品零售" icon={Store} />}
          {can(user, 'access') && <SidebarLink to="/access" label="門禁入場" icon={ScanLine} />}
          {can(user, 'staff') && <SidebarLink to="/staff" label="員工與教練" icon={UserCog} />}
          {can(user, 'reports') && <SidebarLink to="/reports" label="營收報表" icon={BarChart3} />}
          {can(user, 'settings') && <SidebarLink to="/settings" label="教室設定" icon={Settings} />}
          <SidebarLink to="/clock" label="打卡" icon={ClockIcon} />
          <SidebarLink to="/accounts" label={isAdmin(user) ? '帳號權限' : '我的帳號'} icon={ShieldCheck} />
        </nav>
        <div className="px-3 pb-3 pb-safe flex items-center justify-between gap-2">
          <span className="text-xs text-gray-300 pl-1">StudioMate v0.3</span>
          <button onClick={handleLogout} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1 hover:border-red-200 hover:text-red-500 transition-colors">
            登出
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="md:hidden flex items-center gap-2 bg-white border-b border-gray-100 px-3 pb-2 pt-safe-2 flex-shrink-0">
          <button onClick={() => setMenuOpen(true)} className="p-2 -ml-1 rounded-lg hover:bg-gray-100" aria-label="開啟選單">
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="w-7 h-7 bg-brand rounded-lg flex items-center justify-center flex-shrink-0">
            <Dumbbell className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-gray-800 text-sm truncate">{studioName || 'StudioMate'}</span>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-4 md:p-6"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ to, label, icon: Icon, exact, badge }: { to: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`
      }
    >
      <Icon className="w-4 h-4" />
      {label}
      {!!badge && <span className="ml-auto text-[11px] bg-red-500 text-white rounded-full px-1.5 min-w-[1.25rem] text-center">{badge}</span>}
    </NavLink>
  );
}
