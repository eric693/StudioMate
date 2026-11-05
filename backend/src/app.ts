import 'dotenv/config';
// 讓 async 路由丟出的錯誤交給下方錯誤處理，而不是讓請求一直卡住沒有回應
import 'express-async-errors';
import path from 'path';
import fs from 'fs';
import express, { NextFunction, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import cors from 'cors';
import { ZodError } from 'zod';
import routes from './routes/index';
import { HttpError } from './utils/http';
import { startScheduler } from './services/cronService';
import { config } from './config';

export const prisma = new PrismaClient();

const app = express();
// 在 nginx 後面，讓 req.ip 取到真實用戶 IP（登入次數限制用）
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
}));
// 保留原始內容：LINE webhook 驗證簽章需要未經解析的 body
app.use(express.urlencoded({ extended: false, limit: '100kb' })); // 綠界付款通知為表單格式
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8'); } }));

app.use('/api', routes);

app.get('/health', (_req, res) => res.json({ ok: true }));

// 前端：直接由後端提供 frontend/dist（單一 port 即可運作，nginx 只需反代到這個 port）
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST, {
    setHeaders: (res, file) => {
      // index.html 不快取才能即時拿到新版；assets 檔名含雜湊，可以長期快取
      // index.html、Service Worker、manifest 不快取才能即時拿到新版
      if (/(index\.html|sw\.js|\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      else if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    // 帶副檔名的路徑是找不到的靜態檔，回 404 而不是首頁（避免瀏覽器把 HTML 當成 JS／CSS）
    if (path.extname(req.path)) { res.status(404).end(); return; }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

// 統一錯誤處理：業務規則錯誤與資料格式錯誤回 4xx，其餘回 500，都用 JSON 讓前端顯示訊息
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? '資料格式不正確', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return;
  }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: '資料格式不正確，請檢查欄位後再試一次' });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') { res.status(409).json({ error: '資料重複，已有相同的紀錄' }); return; }
    if (err.code === 'P2025') { res.status(404).json({ error: '找不到資料' }); return; }
    if (err.code === 'P2003') { res.status(409).json({ error: '這筆資料仍被其他資料使用，無法刪除' }); return; }
  }
  res.status(500).json({ error: '伺服器發生錯誤，請稍後再試' });
});

const PORT = Number(process.env.PORT ?? 3720);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StudioMate API running on http://localhost:${PORT}`);
    if (config.schedulerEnabled) startScheduler();
  });
}

export default app;
