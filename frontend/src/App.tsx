import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { canRoute, firstAllowedRoute } from './lib/permissions';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Schedule from './pages/Schedule';
import Templates from './pages/Templates';
import Members from './pages/Members';
import MemberDetail from './pages/MemberDetail';
import Catalog from './pages/Catalog';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Accounts from './pages/Accounts';
import Portal from './pages/portal/Portal';
import Orders from './pages/Orders';
import Marketing from './pages/Marketing';
import Rentals from './pages/Rentals';
import CheckInDisplay from './pages/CheckInDisplay';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">載入中...</div>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

/** 員工進到沒有權限的頁面：首頁導到第一個可用頁，其他顯示無權限 */
function PermissionGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (canRoute(user, pathname)) return <>{children}</>;
  if (pathname === '/') return <Navigate to={firstAllowedRoute(user)} replace />;
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <div className="text-gray-700 font-semibold mb-1">您沒有使用此功能的權限</div>
      <div className="text-sm text-gray-400">如需開通，請聯絡管理員到「帳號權限」設定。</div>
    </div>
  );
}

const gated = (el: React.ReactNode) => <PermissionGate>{el}</PermissionGate>;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 會員專區：獨立登入，不需要教室帳號 */}
        <Route path="/m/*" element={<Portal />} />
        <Route path="*" element={
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/checkin-display" element={<PrivateRoute>{gated(<CheckInDisplay />)}</PrivateRoute>} />
              <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
                <Route index element={gated(<Dashboard />)} />
                <Route path="schedule" element={gated(<Schedule />)} />
                <Route path="templates" element={gated(<Templates />)} />
                <Route path="members" element={gated(<Members />)} />
                <Route path="members/:id" element={gated(<MemberDetail />)} />
                <Route path="orders" element={gated(<Orders />)} />
                <Route path="catalog" element={gated(<Catalog />)} />
                <Route path="marketing" element={gated(<Marketing />)} />
                <Route path="rentals" element={gated(<Rentals />)} />
                <Route path="reports" element={gated(<Reports />)} />
                <Route path="settings" element={gated(<Settings />)} />
                <Route path="accounts" element={<Accounts />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        } />
      </Routes>
    </BrowserRouter>
  );
}
