import { z } from 'zod';
import { ERROR_CODES } from '../errors';

export const PAGE_SIZE = 20; // PERF-4: lists are paginated, 20 per page

export const idSchema = z.uuid();

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.literal(PAGE_SIZE),
    total: z.number().int().min(0),
  });

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
