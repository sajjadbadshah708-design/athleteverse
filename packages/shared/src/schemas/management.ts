// SRS Tables 9-11, MVP F1/F5: manager onboarding and venue operations.
import { z } from 'zod';
import { emailSchema, fullNameSchema, passwordSchema, phoneSchema, registerRequestSchema } from './auth';
import { idSchema } from './common';

export const managerRegisterSchema = registerRequestSchema.extend({
  businessName: z.string().trim().min(3).max(80), nationalIdNo: z.string().trim().min(5).max(50),
  businessAddress: z.string().trim().min(3).max(250),
});
export type ManagerRegister = z.infer<typeof managerRegisterSchema>;
export const adminOtpRequestSchema = z.object({ email: emailSchema, password: z.string().min(1) });
export const adminOtpVerifySchema = adminOtpRequestSchema.extend({ code: z.string().regex(/^\d{6}$/) });
export const adminOtpResponseSchema = z.object({ status: z.literal('OTP_REQUIRED') });
export const managerStatusSchema = z.object({ id: idSchema, fullName: z.string(), email: z.string(), status: z.enum(['PENDING_APPROVAL', 'REJECTED', 'ACTIVE']),
  businessName: z.string(), nationalIdNo: z.string(), businessAddress: z.string(), rejectionReason: z.string().nullable() });
export const managersListSchema = z.object({ items: z.array(managerStatusSchema) });
export type ManagerStatus = z.infer<typeof managerStatusSchema>;
export const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(3).max(500) });
export const venueInputSchema = z.object({
  name: z.string().trim().min(3).max(80), description: z.string().trim().max(500).optional(), address: z.string().trim().min(3).max(250),
  cityId: z.number().int().positive(), phone: phoneSchema,
  openHour: z.number().int().min(0).max(23), closeHour: z.number().int().min(1).max(24),
  peakStartHour: z.number().int().min(0).max(23).nullable().optional(), peakEndHour: z.number().int().min(1).max(24).nullable().optional(),
}).superRefine((v, c) => {
  if (v.closeHour <= v.openHour) c.addIssue({ code: 'custom', path: ['closeHour'], message: 'Closing must be later than opening' });
  if ((v.peakStartHour != null || v.peakEndHour != null) &&
      (v.peakStartHour == null || v.peakEndHour == null || v.peakStartHour < v.openHour || v.peakEndHour > v.closeHour || v.peakStartHour >= v.peakEndHour)) {
    c.addIssue({ code: 'custom', path: ['peakStartHour'], message: 'Peak hours must be within opening hours' });
  }
});
export const managedVenueSchema = z.object({ id: idSchema, name: z.string(), cityId: z.number().int(), address: z.string(), openHour: z.number().int(), closeHour: z.number().int(), status: z.string() });
export const managedVenuesSchema = z.object({ items: z.array(managedVenueSchema) });
export type ManagedVenue = z.infer<typeof managedVenueSchema>;
export const courtInputSchema = z.object({ name: z.string().trim().min(1).max(30), sportId: z.number().int().positive(),
  priceRegular: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).refine(n => Number(n) > 0),
  pricePeak: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).refine(n => Number(n) > 0).nullable().optional() });
export const courtCreatedSchema = z.object({ id: idSchema, name: z.string(), sportId: z.number().int(), priceRegular: z.string(), pricePeak: z.string().nullable() });
export const staffInviteSchema = z.object({ fullName: fullNameSchema, email: emailSchema, phone: phoneSchema });
export const inviteResultSchema = z.object({ ok: z.literal(true) });
export const acceptInviteSchema = z.object({ userId: idSchema, token: z.string().min(20).max(200), password: passwordSchema });
export const staffListSchema = z.object({ items: z.array(z.object({ id: idSchema, fullName: z.string(), email: z.string(), status: z.string(), disabled: z.boolean() })) });
export type StaffMember = z.infer<typeof staffListSchema>['items'][number];

export const myManagerStatusSchema = z.object({ status: z.string(), rejectionReason: z.string().nullable(), businessName: z.string() });
export type MyManagerStatus = z.infer<typeof myManagerStatusSchema>;
