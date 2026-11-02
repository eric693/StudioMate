import { BookingStatus, Membership } from '../../types';

export interface Me {
  member: {
    id: string; name: string; phone: string; email: string | null; calendarToken: string;
    invoiceCarrierType: string | null; invoiceCarrierNum: string | null; invoiceTaxId: string | null; invoiceTitle: string | null;
  };
  studio: {
    name: string; phone: string | null; address: string | null; cancelDeadlineHours: number; lateCancelForfeit: boolean; bookingWindowDays: number;
    timezone: string; selfCheckIn: boolean; invoiceEnabled: boolean; referralReward: number;
  };
  features: { shop: boolean; private: boolean; branches: { id: string; name: string }[] };
  terms: { text: string; version: number } | null;
  suspendedUntil: string | null;
  passes: Membership[];
}

export interface Slot {
  id: string; startsAt: string; endsAt: string; room: string | null; coach: string | null; capacity: number; spotsLeft: number; waitlist: number;
  classType: { id: string; name: string; color: string; creditCost: number; isOnline: boolean };
  branch: { id: string; name: string } | null; live: boolean;
  myBooking: { id: string; status: BookingStatus } | null;
}

export interface MyBooking {
  id: string; status: BookingStatus; startsAt: string; endsAt: string; classType: string; color: string; coach: string | null; room: string | null;
  creditsCharged: number; live: boolean; isPrivate: boolean; branch: string | null;
}

/** 子頁面通知首頁：顯示提示並重新載入會員資料 */
export type Notify = (msg: string) => void;
