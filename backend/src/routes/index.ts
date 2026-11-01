import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { requireMember } from '../middleware/memberAuth';
import { register, login, me, updateMe, demoAccount } from '../controllers/authController';
import { listModules, listUsers, createUser, updateUser, deleteUser } from '../controllers/userController';
import { getStudioSettings, updateStudioSettings, listNotifications } from '../controllers/studioController';
import {
  listClassTypes, createClassType, updateClassType, deleteClassType,
  listCoaches, createCoach, updateCoach, deleteCoach,
  listPlans, createPlan, updatePlan, deletePlan,
} from '../controllers/catalogController';
import {
  listMembers, getMember, createMember, updateMember, deleteMember, createBindingCode, unbindLine,
  sell, freeze, unfreeze, updateMembership, listMemberships, deleteMembership,
} from '../controllers/memberController';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, runGenerate,
  listSessions, getSession, createSession, updateSession, cancelSessionHandler, deleteSession,
  createBooking, cancelBookingHandler, attendance,
} from '../controllers/scheduleController';
import { getDashboard, getRevenueReport } from '../controllers/dashboardController';
import { memberLogin, memberAuthConfig, memberMe, memberSchedule, memberBook, memberCancel, memberBookings } from '../controllers/portalController';
import { webhook } from '../controllers/lineController';

const r = Router();

// ── 公開 ──
r.post('/auth/register', register);
r.post('/auth/login', login);
r.get('/auth/demo', demoAccount);
r.post('/line/webhook', webhook);

// ── 會員端 ──
r.get('/portal/config', memberAuthConfig);
r.post('/portal/login', memberLogin);
r.get('/portal/me', requireMember, memberMe);
r.get('/portal/schedule', requireMember, memberSchedule);
r.get('/portal/bookings', requireMember, memberBookings);
r.post('/portal/bookings', requireMember, memberBook);
r.post('/portal/bookings/:id/cancel', requireMember, memberCancel);

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

r.get('/studio', getStudioSettings);
r.put('/studio', updateStudioSettings);
r.get('/studio/notifications', listNotifications);

r.get('/class-types', listClassTypes);
r.post('/class-types', createClassType);
r.put('/class-types/:id', updateClassType);
r.delete('/class-types/:id', deleteClassType);
r.get('/coaches', listCoaches);
r.post('/coaches', createCoach);
r.put('/coaches/:id', updateCoach);
r.delete('/coaches/:id', deleteCoach);
r.get('/plans', listPlans);
r.post('/plans', createPlan);
r.put('/plans/:id', updatePlan);
r.delete('/plans/:id', deletePlan);

r.get('/members', listMembers);
r.post('/members', createMember);
r.get('/members/:id', getMember);
r.put('/members/:id', updateMember);
r.delete('/members/:id', deleteMember);
r.post('/members/:id/binding-code', createBindingCode);
r.delete('/members/:id/line', unbindLine);
r.get('/memberships', listMemberships);
r.post('/memberships', sell);
r.delete('/memberships/:id', deleteMembership);
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

export default r;
