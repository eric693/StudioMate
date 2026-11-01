// 前端共用型別（對應後端 Prisma 模型）
export interface User {
  id: string;
  /** 登入帳號（Email 或自訂帳號） */
  email: string;
  name: string;
  role?: 'ADMIN' | 'STAFF';
  permissions?: string[];
  ownerId?: string | null;
  active?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface ClassType { id: string; name: string; color: string; durationMin: number; defaultCapacity: number; creditCost: number; active: boolean }
export interface Coach { id: string; name: string; phone?: string | null; color: string; active: boolean }
export type PlanKind = 'PACK' | 'PERIOD' | 'DROPIN';
export interface Plan { id: string; name: string; kind: PlanKind; credits: number | null; validDays: number; price: number; classTypeIds: string[]; dailyLimit: number | null; active: boolean }

export type MembershipStatus = 'ACTIVE' | 'FROZEN' | 'EXPIRED' | 'CANCELLED';
export interface Membership {
  id: string; planId: string; planName: string; kind: PlanKind; creditsTotal: number | null; creditsLeft: number | null;
  startDate: string; endDate: string; status: MembershipStatus; frozenFrom: string | null; frozenUntil: string | null;
  price: number; payMethod: string; paidAt: string; note: string | null;
}
export interface PassSummary { id: string; planName: string; kind: PlanKind; creditsLeft: number | null; endDate: string; status: MembershipStatus }
export interface Member {
  id: string; name: string; phone: string; email: string | null; birthday: string | null; emergencyContact: string | null;
  note: string | null; status: 'ACTIVE' | 'INACTIVE'; lineBound: boolean; lineDisplayName?: string | null; createdAt: string;
  activePasses?: PassSummary[];
}

export type BookingStatus = 'BOOKED' | 'WAITLIST' | 'CANCELLED' | 'LATE_CANCELLED' | 'ATTENDED' | 'NO_SHOW';
export interface Session {
  id: string; startsAt: string; endsAt: string; capacity: number; room: string | null; status: 'SCHEDULED' | 'CANCELLED';
  cancelReason: string | null; note: string | null; templateId: string | null;
  classType: ClassType; coach: Coach | null; booked: number; waitlist: number; attended: number;
}
export interface RosterBooking {
  id: string; status: BookingStatus; creditsCharged: number; bookedAt: string; checkedInAt: string | null; promotedAt: string | null; source: 'STAFF' | 'MEMBER';
  member: { id: string; name: string; phone: string };
  membership: { planName: string; kind: PlanKind; creditsLeft: number | null } | null;
}
export interface Template {
  id: string; weekday: number; startTime: string; durationMin: number; capacity: number; room: string | null;
  activeFrom: string; activeTo: string | null; classType: ClassType; coach: Coach | null; classTypeId: string; coachId: string | null;
}
export interface Studio {
  name: string; phone: string | null; address: string | null; timezone: string; bookingWindowDays: number; cancelDeadlineHours: number;
  lateCancelForfeit: boolean; waitlistEnabled: boolean; autoAttend: boolean; remindBeforeHours: number; expiryRemindDays: number;
  lowCreditThreshold: number; lineEnabled?: boolean;
}
