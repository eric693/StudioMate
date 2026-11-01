import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // 登入失敗本身也是 401，留在登入頁顯示錯誤，不要重新導向
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    // 新增／修改／刪除失敗時一律跳出提示，避免畫面沒反應（表單可再自行顯示細節）
    const method = (err.config?.method ?? 'get').toLowerCase();
    if (err.response?.status !== 401 && method !== 'get' && !err.config?.url?.includes('/auth/login')) {
      showErrorToast(err.response?.data?.error ?? (err.response ? '儲存失敗，請稍後再試' : '連線失敗，請檢查網路'));
    }
    return Promise.reject(err);
  }
);

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showErrorToast(message: string) {
  let el = document.getElementById('api-error-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'api-error-toast';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;max-width:calc(100% - 32px);'
      + 'background:#dc2626;color:#fff;font-size:14px;padding:10px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.18)';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el) el.style.display = 'none'; }, 4000);
}

export default api;
