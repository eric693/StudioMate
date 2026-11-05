// 前端共用型別（對應後端 Prisma 模型）
export interface User {
  id: string;
  /** 登入帳號（Email 或自訂帳號） */
  email: string;
  name: string;
  role?: 'ADMIN' | 'STAFF';
  permissions?: string[];
  ownerId?: string | null;
  coachId?: string | null;
  active?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface ClassType { id: string; name: string; color: string; durationMin: number; defaultCapacity: number; creditCost: number; active: boolean; isPrivate: boolean; isOnline: boolean }
export interface Coach {
  id: string; name: string; phone?: string | null; color: string; active: boolean;
  payPerClass: number; payPerHead: number; headThreshold: number; revenueShare: number; shareTiers?: { min: number; rate: number }[] | null; _count?: { availability: number };
}
export interface Branch { id: string; name: string; address: string | null; phone: string | null; active: boolean }
export type PlanKind = 'PACK' | 'PERIOD' | 'DROPIN';
export interface Plan {
  id: string; name: string; kind: PlanKind; credits: number | null; validDays: number; price: number; classTypeIds: string[]; dailyLimit: number | null; active: boolean;
  onlineSale: boolean; trialOnly: boolean; description: string | null; recurring?: boolean;
}

export type MembershipStatus = 'ACTIVE' | 'FROZEN' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED' | 'TRANSFERRED';
export interface Membership {
  id: string; planId: string; planName: string; kind: PlanKind; creditsTotal: number | null; creditsLeft: number | null;
  startDate: string; endDate: string; status: MembershipStatus; frozenFrom: string | null; frozenUntil: string | null;
  price: number; payMethod: string; paidAt: string; note: string | null; valueBase?: number | null; subscriptionId?: string | null;
  discount: number; invoiceNo: string | null; invoiceDate: string | null; invoiceStatus: 'ISSUED' | 'VOID' | 'FAILED' | null; invoiceError: string | null;
}
export interface PassSummary { id: string; planName: string; kind: PlanKind; creditsLeft: number | null; endDate: string; status: MembershipStatus }
export interface Member {
  id: string; name: string; phone: string; email: string | null; birthday: string | null; emergencyContact: string | null;
  note: string | null; status: 'ACTIVE' | 'INACTIVE'; lineBound: boolean; lineDisplayName?: string | null; createdAt: string;
  referralCode?: string | null; referredById?: string | null;
  invoiceCarrierType?: string | null; invoiceCarrierNum?: string | null; invoiceTaxId?: string | null; invoiceTitle?: string | null;
  activePasses?: PassSummary[];
}

export type BookingStatus = 'BOOKED' | 'WAITLIST' | 'CANCELLED' | 'LATE_CANCELLED' | 'ATTENDED' | 'NO_SHOW';
export interface Session {
  id: string; startsAt: string; endsAt: string; capacity: number; room: string | null; status: 'SCHEDULED' | 'CANCELLED';
  cancelReason: string | null; note: string | null; templateId: string | null;
  classType: ClassType; coach: Coach | null; booked: number; waitlist: number; attended: number;
  branch: { id: string; name: string } | null; liveUrl: string | null; isPrivate: boolean;
}
export interface RosterBooking {
  id: string; status: BookingStatus; creditsCharged: number; bookedAt: string; checkedInAt: string | null; promotedAt: string | null; source: 'STAFF' | 'MEMBER';
  member: { id: string; name: string; phone: string };
  membership: { planName: string; kind: PlanKind; creditsLeft: number | null } | null;
}
export interface Template {
  id: string; weekday: number; startTime: string; durationMin: number; capacity: number; room: string | null;
  activeFrom: string; activeTo: string | null; classType: ClassType; coach: Coach | null; classTypeId: string; coachId: string | null;
  branchId: string | null; branch: { id: string; name: string } | null; liveUrl: string | null;
}
export interface Studio {
  name: string; phone: string | null; address: string | null; timezone: string; bookingWindowDays: number; cancelDeadlineHours: number;
  lateCancelForfeit: boolean; waitlistEnabled: boolean; autoAttend: boolean; remindBeforeHours: number; expiryRemindDays: number;
  lowCreditThreshold: number; lineEnabled?: boolean;
  noShowLimit: number; noShowWindowDays: number; noShowSuspendDays: number; lateCancelCountsAsNoShow: boolean;
  terms: string | null; termsVersion: number; selfCheckIn: boolean; checkInBeforeMin: number;
  onlinePayEnabled: boolean; transferEnabled: boolean; bankInfo: string | null;
  ecpayMode: 'stage' | 'production'; ecpayMerchantId: string | null; ecpayHashKeySet?: boolean; ecpayHashIVSet?: boolean;
  invoiceEnabled: boolean; invoiceMode: 'stage' | 'production'; invoiceMerchantId: string | null; invoiceHashKeySet?: boolean; invoiceHashIVSet?: boolean;
  referralRewardAmount: number;
  refundFeePercent: number; transferFee: number; trustType: string | null; trustBank: string | null; trustNote: string | null;
  installments: string | null; installmentMin: number;
  linePayEnabled: boolean; linePayMode: 'sandbox' | 'production'; linePayChannelId: string | null; linePaySecretSet?: boolean;
  contractEnabled: boolean; contractText: string | null;
  birthdayEnabled: boolean; birthdayMessage: string | null; birthdayCoupon: number;
  winbackEnabled: boolean; winbackDays: number; winbackMessage: string | null; winbackCoupon: number;
  accessAutoCheckIn: boolean;
}
export interface Coupon {
  id: string; code: string; name: string; discountType: 'AMOUNT' | 'PERCENT'; value: number; planIds: string[]; minAmount: number;
  maxUses: number | null; perMemberLimit: number; usedCount: number; validFrom: string | null; validTo: string | null;
  memberId: string | null; memberName?: string | null; newMemberOnly: boolean; active: boolean; note: string | null; createdAt: string;
}
export type OrderStatus = 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED' | 'FAILED';
export interface Order {
  id: string; tradeNo: string; method: 'ONLINE' | 'TRANSFER' | 'LINEPAY'; status: OrderStatus; recurring?: boolean; originalAmount: number; discount: number; amount: number;
  transferLast5: string | null; transferAt: string | null; paidAt: string | null; paymentType: string | null; rejectReason: string | null;
  membershipId: string | null; createdAt: string;
  member?: { id: string; name: string; phone: string }; plan: { name: string }; coupon?: { code: string } | null;
}
export interface Room { id: string; name: string; branchId: string | null; branch?: { id: string; name: string } | null; hourlyRate: number; capacity: number | null; active: boolean; note: string | null }
export interface Rental {
  id: string; roomId: string; room: { id: string; name: string; hourlyRate: number }; memberId: string | null; renterName: string; renterPhone: string | null;
  startsAt: string; endsAt: string; price: number; paid: boolean; payMethod: string | null; status: 'BOOKED' | 'CANCELLED'; note: string | null;
}
