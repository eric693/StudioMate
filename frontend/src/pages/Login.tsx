import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState<{ account: string; password: string } | null>(null);

  // 示範帳號由後端 .env 設定，未設定時不顯示
  useEffect(() => {
    api.get('/auth/demo').then((r) => setDemo(r.data)).catch(() => setDemo(null));
  }, []);

  function fillDemo() {
    if (!demo) return;
    setEmail(demo.account);
    setPassword(demo.password);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? '帳號或密碼錯誤');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white text-2xl font-bold">P</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">StudioMate 教室管家</h1>
          <p className="text-gray-500 text-sm mt-1">健身房、瑜珈、舞蹈、拳擊教室的課表與會員管理</p>
        </div>

        {demo && (
          <div className="mb-4 rounded-xl border border-brand/30 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <div className="font-semibold text-gray-800 mb-1">示範帳號</div>
                <div className="text-gray-600">帳號：<span className="font-mono font-semibold text-gray-900 select-all">{demo.account}</span></div>
                <div className="text-gray-600">密碼：<span className="font-mono font-semibold text-gray-900 select-all">{demo.password}</span></div>
              </div>
              <button type="button" onClick={fillDemo} className="shrink-0 rounded-lg border border-brand px-3 py-2 text-sm font-medium text-brand hover:bg-brand hover:text-white transition-colors">
                一鍵帶入
              </button>
            </div>
          </div>
        )}

        <div className="card shadow-md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">帳號</label>
              <input
                type="text"
                autoCapitalize="none"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="Email 或自訂帳號"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
              {loading ? '登入中...' : '登入'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-400 mt-5">
          是會員嗎？<Link to="/m" className="text-brand font-medium hover:underline">到會員專區預約課程</Link>
        </p>
      </div>
    </div>
  );
}
