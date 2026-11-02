import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { requireMember } from '../middleware/memberAuth';
import { register, login, me, updateMe, demoAccount } from '../controllers/authController';
import { listModules, listUsers, createUser, updateUser, deleteUser } from '../controllers/userController';
import { getStudioSettings, updateStudioSettings, listNotifications, publishTerms } from '../controllers/studioController';
import {
  listClassTypes, createClassType, updateClassType, deleteClassType,
  listCoaches, createCoach, updateCoach, deleteCoach,
  listPlans, createPlan, updatePlan, deletePlan,
} from '../controllers/catalogController';
import {
  listMembers, getMember, createMember, updateMember, deleteMember, createBindingCode, unbindLine,
  sell, freeze, unfreeze, updateMembership, listMemberships, deleteMembership, referralCode,
} from '../controllers/memberController';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, runGenerate,
  listSessions, getSession, createSession, updateSession, cancelSessionHandler, deleteSession,
  createBooking, cancelBookingHandler, attendance,
} from '../controllers/scheduleController';
import { getDashboard, getRevenueReport } from '../controllers/dashboardController';
import {
  memberLogin, memberAuthConfig, memberMe, memberSchedule, memberBook, memberCancel, memberBookings, acceptTerms, updateMemberProfile,
} from '../controllers/portalController';
import {
  listOrders, approveOrder, rejectOrderHandler, deleteOrder, listCoupons, createCoupon, updateCoupon, deleteCoupon, quoteCouponHandler,
  issueInvoiceHandler, voidInvoiceHandler, ecpayNotify, portalShop, portalQuote, portalCreateOrder, portalPayForm, portalSubmitTransfer,
  portalCancelOrder, portalOrders, portalCoupons,
} from '../controllers/commerceController';
import {
  checkInInfo, rotateCheckIn, memberCheckIn, getAvailability, setAvailability, staffPrivateSlots, staffPrivateBook, staffPrivateOptions,
  portalPrivateOptions, portalPrivateSlots, portalPrivateBook, portalLiveLink, calendarFeed, coachPay,
  listBranches, createBranch, updateBranch, deleteBranch, listRooms, createRoom, updateRoom, deleteRoom,
  listRentals, createRental, updateRental, deleteRental,
} from '../controllers/opsController';
import { previewSegment, sendCampaign, listCampaigns, deleteCampaign, listReferrals, portalReferral } from '../controllers/marketingController';
import { exportMembers, exportSales, exportAttendance, exportCoachPay, importMembers } from '../controllers/dataController';
import { webhook } from '../controllers/lineController';

const r = Router();

// ── 公開 ──
r.post('/auth/register', register);
r.post('/auth/login', login);
r.get('/auth/demo', demoAccount);
r.post('/line/webhook', webhook);
r.post('/pay/ecpay/notify', ecpayNotify);
r.get('/cal/:token', calendarFeed); // 行事曆訂閱（網址本身就是憑證）

// ── 會員端 ──
r.get('/portal/config', memberAuthConfig);
r.post('/portal/login', memberLogin);
r.get('/portal/me', requireMember, memberMe);
r.get('/portal/schedule', requireMember, memberSchedule);
r.get('/portal/bookings', requireMember, memberBookings);
r.post('/portal/bookings', requireMember, memberBook);
r.post('/portal/bookings/:id/cancel', requireMember, memberCancel);
r.get('/portal/bookings/:id/live', requireMember, portalLiveLink);
r.post('/portal/terms', requireMember, acceptTerms);
r.put('/portal/me', requireMember, updateMemberProfile);
r.post('/portal/checkin', requireMember, memberCheckIn);
r.get('/portal/shop', requireMember, portalShop);
r.post('/portal/quote', requireMember, portalQuote);
r.get('/portal/orders', requireMember, portalOrders);
r.post('/portal/orders', requireMember, portalCreateOrder);
r.post('/portal/orders/:id/pay', requireMember, portalPayForm);
r.post('/portal/orders/:id/transfer', requireMember, portalSubmitTransfer);
r.post('/portal/orders/:id/cancel', requireMember, portalCancelOrder);
r.get('/portal/coupons', requireMember, portalCoupons);
r.get('/portal/referral', requireMember, portalReferral);
r.get('/portal/private/options', requireMember, portalPrivateOptions);
r.get('/portal/private/slots', requireMember, portalPrivateSlots);
r.post('/portal/private/book', requireMember, portalPrivateBook);

// ── 教室端（需登入；員工依模組權限，見 middleware/permissions.ts） ──
r.use(requireAuth);
r.get('/auth/me', me);
r.put('/auth/me', updateMe);

r.get('/users/modules', requireAdmin, listModules);
r.get('/users', requireAdmin, listUsers);
r.post('/users', requireAdmin, createUser);
r.put('/users/:id', requireAdmin, updateUser);
r.delete('/users/:id', requireAdmin, deleteUser);

r.get('/dashboard', getDashboard);
r.get('/reports/revenue', getRevenueReport);
r.get('/reports/sales', listMemberships);
r.get('/reports/coach-pay', coachPay);
r.get('/reports/export/sales', exportSales);
r.get('/reports/export/attendance', exportAttendance);
r.get('/reports/export/coach-pay', exportCoachPay);

r.get('/studio', getStudioSettings);
r.put('/studio', updateStudioSettings);
r.get('/studio/notifications', listNotifications);
r.put('/studio/terms', publishTerms);
r.get('/studio/checkin', checkInInfo);
r.post('/studio/checkin/rotate', rotateCheckIn);
r.get('/branches', listBranches);
r.post('/branches', createBranch);
r.put('/branches/:id', updateBranch);
r.delete('/branches/:id', deleteBranch);

r.get('/class-types', listClassTypes);
r.post('/class-types', createClassType);
r.put('/class-types/:id', updateClassType);
r.delete('/class-types/:id', deleteClassType);
r.get('/coaches', listCoaches);
r.post('/coaches', createCoach);
r.put('/coaches/:id', updateCoach);
r.delete('/coaches/:id', deleteCoach);
r.get('/coaches/:id/availability', getAvailability);
r.put('/coaches/:id/availability', setAvailability);
r.get('/plans', listPlans);
r.post('/plans', createPlan);
r.put('/plans/:id', updatePlan);
r.delete('/plans/:id', deletePlan);

r.get('/members', listMembers);
r.get('/members/export', exportMembers);
r.post('/members/import', importMembers);
r.post('/members', createMember);
r.get('/members/:id', getMember);
r.put('/members/:id', updateMember);
r.delete('/members/:id', deleteMember);
r.post('/members/:id/binding-code', createBindingCode);
r.delete('/members/:id/line', unbindLine);
r.post('/members/:id/referral-code', referralCode);
r.get('/memberships', listMemberships);
r.post('/memberships', sell);
r.delete('/memberships/:id', deleteMembership);
r.post('/memberships/:id/invoice', issueInvoiceHandler);
r.post('/memberships/:id/invoice/void', voidInvoiceHandler);
r.post('/memberships/quote', quoteCouponHandler);
r.get('/orders', listOrders);
r.post('/orders/:id/approve', approveOrder);
r.post('/orders/:id/reject', rejectOrderHandler);
r.delete('/orders/:id', deleteOrder);
r.put('/memberships/:id', updateMembership);
r.post('/memberships/:id/freeze', freeze);
r.post('/memberships/:id/unfreeze', unfreeze);

r.get('/templates', listTemplates);
r.post('/templates', createTemplate);
r.put('/templates/:id', updateTemplate);
r.delete('/templates/:id', deleteTemplate);
r.post('/templates/generate', runGenerate);

r.get('/sessions', listSessions);
r.post('/sessions', createSession);
r.get('/sessions/:id', getSession);
r.put('/sessions/:id', updateSession);
r.post('/sessions/:id/cancel', cancelSessionHandler);
r.delete('/sessions/:id', deleteSession);

r.post('/bookings', createBooking);
r.post('/bookings/:id/cancel', cancelBookingHandler);
r.post('/bookings/:id/attendance', attendance);
r.get('/private/options', staffPrivateOptions);
r.get('/private/slots', staffPrivateSlots);
r.post('/private/book', staffPrivateBook);

r.get('/coupons', listCoupons);
r.post('/coupons', createCoupon);
r.put('/coupons/:id', updateCoupon);
r.delete('/coupons/:id', deleteCoupon);
r.get('/marketing/segment', previewSegment);
r.get('/campaigns', listCampaigns);
r.post('/campaigns', sendCampaign);
r.delete('/campaigns/:id', deleteCampaign);
r.get('/marketing/referrals', listReferrals);

r.get('/rooms', listRooms);
r.post('/rooms', createRoom);
r.put('/rooms/:id', updateRoom);
r.delete('/rooms/:id', deleteRoom);
r.get('/rentals', listRentals);
r.post('/rentals', createRental);
r.put('/rentals/:id', updateRental);
r.delete('/rentals/:id', deleteRental);

export default r;
