import { z } from 'zod';
import { query } from '$app/server';
import { requireCapability } from '#lib/server/authorization.js';
import { listAuditEntries } from '#lib/server/audit/audit-service.js';
import { auditActions, auditSubjectTypes } from '#lib/types/audit.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const auditLogFilters = z.object({
	action: z.enum(auditActions).optional(),
	search: z.string().max(200).optional(),
	subjectType: z.enum(auditSubjectTypes).optional(),
	from: day.optional(),
	to: day.optional(),
	page: z.number().int().min(1).optional()
});

/** The cross-member audit log. Per-member History stays on `user.read` (`getUserHistory`). */
export const getAuditLog = query(auditLogFilters, async ({ page, ...filters }) => {
	await requireCapability('audit.read');
	return listAuditEntries(filters, { page: page ?? 1, pageSize: 50 });
});
