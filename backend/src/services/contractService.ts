// 電子合約：範本變數代入、簽名檢查、建立合約紀錄
import { Member, Plan, Studio } from '@prisma/client';
import { prisma } from '../app';
import { badRequest } from '../utils/http';
import { addDays, localDate } from '../utils/time';

const TRUST_LABEL: Record<string, string> = { TRUST: '信託', GUARANTEE: '銀行履約保證' };

/** 合約範本可用的變數 */
export const CONTRACT_VARS = ['{教室}', '{會員}', '{電話}', '{方案}', '{金額}', '{開始日}', '{到期日}', '{堂數}', '{履約保障}', '{日期}'];

export function renderContract(studio: Studio, member: Pick<Member, 'name' | 'phone'>, plan: Pick<Plan, 'name' | 'kind' | 'credits' | 'validDays'>, price: number, startDate?: string) {
  const today = localDate(new Date(), studio.timezone);
  const start = startDate ?? today;
  const trust = studio.trustType && studio.trustBank
    ? `本教室預收款項已交付${studio.trustBank}辦理${TRUST_LABEL[studio.trustType] ?? studio.trustType}${studio.trustNote ? `（${studio.trustNote}）` : ''}。`
    : '本教室目前未提供預收款履約保障。';
  const map: Record<string, string> = {
    '{教室}': studio.name, '{會員}': member.name, '{電話}': member.phone, '{方案}': plan.name, '{金額}': `新台幣 ${price.toLocaleString('zh-TW')} 元`,
    '{開始日}': start, '{到期日}': addDays(start, plan.validDays - 1), '{堂數}': plan.kind === 'PERIOD' ? '不限堂數' : `${plan.credits ?? 1} 堂`,
    '{履約保障}': trust, '{日期}': today,
  };
  const text = studio.contractText || DEFAULT_CONTRACT;
  return text.replace(/\{[^{}]+\}/g, (k) => map[k] ?? k);
}

export const DEFAULT_CONTRACT = `{教室} 會員服務契約

立契約人：{會員}（電話 {電話}，以下稱會員）向 {教室}（以下稱教室）購買下列方案：

一、方案內容：{方案}，{堂數}，使用期間 {開始日} 至 {到期日}。
二、費用：{金額}。
三、預收款履約保障：{履約保障}
四、終止契約與退費：會員得隨時終止契約，教室依已使用堂數或期間計算後，退還剩餘費用（得扣除教室條款所定之手續費）。
五、轉讓：會員得將剩餘權益轉讓給他人，轉讓手續依教室規定辦理。
六、暫停：會員因傷病、出國等事由，得申請暫停（凍結），到期日依暫停天數順延。
七、其他事項依教室會員條款辦理。

簽約日期：{日期}`;

/** 簽名須是 PNG data URL，且不能太小（空白畫布）或太大 */
export function assertSignature(sig: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig)) throw badRequest('請在簽名框內簽名');
  if (sig.length < 1500) throw badRequest('簽名太簡短，請重新簽名');
  if (sig.length > 400_000) throw badRequest('簽名檔案太大，請重新簽名');
}

export async function createContract(input: {
  userId: string; memberId: string; membershipId?: string | null; content: string; title: string; signerName: string; signature: string; ip?: string; channel: 'FRONT_DESK' | 'ONLINE';
}) {
  assertSignature(input.signature);
  if (!input.signerName.trim()) throw badRequest('請填寫簽署人姓名');
  return prisma.contract.create({
    data: {
      userId: input.userId, memberId: input.memberId, membershipId: input.membershipId ?? null, title: input.title, content: input.content,
      signerName: input.signerName.trim().slice(0, 40), signature: input.signature, signedIp: input.ip?.slice(0, 60), channel: input.channel,
    },
  });
}
