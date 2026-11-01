// 背景排程：課程收尾與上課提醒每 10 分鐘；方案狀態與產生未來課程每天凌晨（另外啟動時先跑一次）
import cron from 'node-cron';
import { closeFinishedSessions } from './bookingService';
import { refreshMembershipStatus } from './membershipService';
import { generateAllStudios } from './scheduleService';
import { runReminders } from './reminderService';

async function safely(name: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    if (r && Object.values(r as object).some((v) => typeof v === 'number' && v > 0)) console.log(`[cron] ${name}`, r);
  } catch (e) {
    console.error(`[cron] ${name} 失敗`, e);
  }
}

export async function runDaily() {
  await safely('refreshMembershipStatus', refreshMembershipStatus);
  await safely('generateSessions', generateAllStudios);
}

export function startScheduler() {
  cron.schedule('*/10 * * * *', async () => {
    await safely('closeFinishedSessions', () => closeFinishedSessions());
    await safely('runReminders', () => runReminders());
  });
  cron.schedule('10 0 * * *', runDaily, { timezone: 'Asia/Taipei' });
  void runDaily();
}
