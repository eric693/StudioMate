// 集中管理外部憑證與功能旗標。
// 未設定憑證時各模組自動以「沙盒模式」運作（LINE 訊息只記錄不送出），日後填入即可切換正式串接。

export const config = {
  jwtSecret: process.env.JWT_SECRET ?? 'dev_secret_change_me',

  // 對外網址（LINE 訊息中的連結用）
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',

  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? '',
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    get enabled() {
      return Boolean(this.channelSecret && this.accessToken);
    },
  },

  // LINE LIFF（會員端）
  liff: {
    id: process.env.LIFF_ID ?? '',
    channelId: process.env.LINE_LOGIN_CHANNEL_ID ?? '',
    get enabled() {
      return Boolean(process.env.LIFF_ID && process.env.LINE_LOGIN_CHANNEL_ID);
    },
  },

  // 登入頁公開顯示的示範帳號。兩者都設定才會顯示；清空即隱藏。
  demo: {
    account: (process.env.DEMO_ACCOUNT ?? '').trim().toLowerCase(),
    password: process.env.DEMO_PASSWORD ?? '',
    get enabled() {
      return Boolean(this.account && this.password);
    },
  },

  // 測試時關閉排程，避免背景工作干擾
  schedulerEnabled: process.env.DISABLE_SCHEDULER !== 'true',
};
