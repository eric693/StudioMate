# StudioMate 教室管家

健身房、瑜珈、舞蹈、拳擊教室的課程預約與會員管理系統。架構沿用 ParkMate：

- **後端** `backend/`：Express + TypeScript + Prisma（PostgreSQL），提供 `/api`，並直接服務前端 build 結果
- **前端** `frontend/`：React + Vite + Tailwind
- **會員端** `/m`：手機網頁，會員以教室產生的 6 碼綁定碼登入（設定 LIFF 後可從 LINE 直接登入）

## 功能

- 固定課表自動排課、臨時加開、取消整堂（自動退堂與通知）
- 預約、候補自動遞補、取消截止與晚取消扣堂、點名（或課程結束自動出席）
- 方案：堂數卡、期限卡（可設每日上限）、單堂；限定課程類型、凍結延期、補堂與作廢
- LINE 提醒：上課前、方案到期前、堂數不足、候補遞補、停課；未設定 LINE 時為沙盒模式（只記錄）
- 營收報表、員工帳號與模組權限、多教室資料隔離

## 開發

```bash
cd backend && npm install && cp .env.example .env   # 填入 DATABASE_URL、JWT_SECRET
npx prisma migrate dev
npm run dev                  # http://localhost:3720
cd ../frontend && npm install && npm run dev   # Vite，/api 代理到 3720
```

測試（需要 `TEST_DATABASE_URL`，會重建該資料庫）：`cd backend && npm test`

Demo 資料（需要 `DEMO_ACCOUNT`、`DEMO_PASSWORD`，會清空 demo 帳號的資料）：`npm run db:seed:demo`

## 部署

```bash
cd frontend && npm ci && npm run build
cd ../backend && npm ci && npx prisma migrate deploy && npm run build
pm2 start dist/app.js --name studiomate --cwd /root/project/StudioMate/backend --node-args="--env-file=.env"
```

## 環境變數

| 變數 | 說明 |
| --- | --- |
| `DATABASE_URL` / `TEST_DATABASE_URL` | PostgreSQL 連線 |
| `JWT_SECRET` | 登入 token 簽章 |
| `PORT` | 預設 3720 |
| `APP_URL` / `FRONTEND_URL` | 對外網址 |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | LINE 官方帳號（Messaging API）；未設定為沙盒模式 |
| `LIFF_ID` / `LINE_LOGIN_CHANNEL_ID` | 會員端從 LINE 直接登入 |
| `DEMO_ACCOUNT` / `DEMO_PASSWORD` | 登入頁的 demo 帳號 |
| `DISABLE_SCHEDULER` | 設為 true 停用排程（排課、提醒、結算） |
