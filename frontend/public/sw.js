// 會員端 Service Worker（範圍 /m）：
// - 畫面：網路優先，斷線時用快取的畫面；完全沒有快取時顯示離線提示頁
// - /assets：檔名含雜湊，快取優先
// - /api：一律走網路，不快取（預約、堂數必須是最新的）
// - 接收手機推播並在點擊時開啟會員網頁
const CACHE = 'studiomate-member-v3';
const SHELL = '/m';
const PRECACHE = [SHELL, '/offline.html', '/icon-192.png', '/member.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('studiomate-member-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SHELL, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) || (await caches.match('/offline.html'))),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // 圖示、manifest 等：先給快取，同時背景更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: '會員通知', body: '', url: '/m' };
  try { data = { ...data, ...event.data.json() }; } catch { if (event.data) data.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url }, tag: undefined, renotify: false,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/m', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith('/m'));
      if (open) { open.navigate(target).catch(() => undefined); return open.focus(); }
      return self.clients.openWindow(target);
    }),
  );
});
