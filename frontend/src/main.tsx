import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


// API 錯誤已由 api client 顯示提示；避免按鈕事件中未接住的 axios 錯誤再變成未處理的 Promise 例外
window.addEventListener('unhandledrejection', (e) => {
  if ((e.reason as { isAxiosError?: boolean })?.isAxiosError) e.preventDefault();
});
