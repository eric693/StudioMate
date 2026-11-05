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
- 營收報表、銷售紀錄、教練薪資（鐘點＋人數加給＋產值抽成）、員工帳號與模組權限、多教室資料隔離
- 線上購買：綠界信用卡（付款通知自動開通）、銀行轉帳（會員回報後五碼、櫃檯審核）
- 電子發票（綠界 B2C）：售卡自動開立、作廢方案一併作廢；支援手機條碼、自然人憑證、捐贈、統編
- 行銷：折價券、名單篩選群發 LINE、轉介紹獎勵；體驗方案限首購
- 自助簽到 QR code、未到違規暫停線上預約、會員條款（改版需重新同意）
- 私人課（依教練每週時段預約）、場地租借（自動避開已排課時段）、多分店、直播課連結、行事曆訂閱（iCal）
- 會員 CSV 匯入（先預覽再寫入）與會員、銷售、上課紀錄、教練薪資匯出

### 第三版

- 退費解約：依已用堂數或天數試算、扣手續費，全額退作廢發票、部分退開折讓單；LINE Pay 訂單直接線上退款
- 會籍轉讓：剩餘堂數或期限移給其他會員，可收轉讓手續費；轉入的方案以剩餘價值計算教練產值
- 預收款履約保障：設定信託或銀行履約保證（顯示在購買頁與合約），報表列出尚未履約的預收款
- 收款：綠界信用卡定期定額（月費自動扣款續約、扣款失敗通知、會員可自行停止）、信用卡分期、LINE Pay 線上付款
- 電子合約：範本變數代入、會員線上購買前或櫃檯手寫簽名，合約內容與簽名存檔
- 教練：階梯式抽成、請假申請與代課（核准後換教練並通知已預約會員）；員工帳號可對應教練
- 員工班表（複製上週）、上下班打卡、出勤報表與補登
- 門禁：會員動態入場 QR code（每 30 秒更新）、櫃檯掃碼、閘門裝置 API（`POST /api/access/check`）、入場自動簽到、入場紀錄
- 置物櫃：批次建立、出租、續租、到期 LINE 提醒；體組成（InBody）量測紀錄，會員端可看變化
- 商品零售：商品與庫存（進貨、盤點、異動紀錄）、櫃檯收銀、多品項電子發票、作廢回補庫存
- 營運分析：續約率與流失、熱門時段熱度圖、課程與教練排行、流失風險名單；營收報表含商品、置物櫃、場地並扣除退費
- 自動行銷：生日祝福與折價券、久未到訪喚回（每天早上 10 點）；公告（可推播 LINE）；滿意度問卷與下課問卷
- 會員端 PWA：可安裝到手機主畫面、Service Worker（斷線時顯示快取畫面與提示）、手機推播通知（Web Push，與 LINE 並行；需設定 `VAPID_PUBLIC_KEY`／`VAPID_PRIVATE_KEY`）

## 開發

```bash
cd backend && npm install && cp .env.example .env   # 填入 DATABASE_URL、JWT_SECRET
npx prisma migrate dev
npm run dev                  # http://localhost:3720
cd ../frontend && npm install && npm run dev   # Vite，/api 代理到 3720
```

測試（需要 `TEST_DATABASE_URL`，會重建該資料庫）：`cd backend && npm run build && npm test`

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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | 會員手機推播（`npx web-push generate-vapid-keys` 產生）；未設定時不提供手機通知 |
| `DISABLE_SCHEDULER` | 設為 true 停用排程（排課、提醒、結算） |

綠界金流與電子發票的特店帳號在後台「教室設定 → 線上購買與發票」設定（每間教室各自設定）；未設定時使用綠界公開的測試帳號，只能在測試環境使用。
