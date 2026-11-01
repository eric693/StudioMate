// 會員端專用的 API client：與後台分開保存 token，401 時回到會員登入畫面
import axios from 'axios';

export const MEMBER_TOKEN = 'memberToken';
const memberApi = axios.create({ baseURL: '/api/portal' });

memberApi.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(MEMBER_TOKEN);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
memberApi.interceptors.response.use(undefined, (err) => {
  if (err.response?.status === 401 && localStorage.getItem(MEMBER_TOKEN)) {
    localStorage.removeItem(MEMBER_TOKEN);
    window.location.href = '/m';
  }
  return Promise.reject(err);
});

export const errorText = (e: unknown) =>
  (axios.isAxiosError(e) && (e.response?.data as { error?: string })?.error) || '連線失敗，請稍後再試';

export default memberApi;
