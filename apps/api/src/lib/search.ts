/** Prisma's `contains` hands % and _ to LIKE as wildcards, so a search for "%" would match every row. Escape them (and the escape character). */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');
