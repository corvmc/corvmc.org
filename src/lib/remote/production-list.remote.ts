import { z } from 'zod';
import { query } from '$app/server';
import { requireCapability } from '#lib/server/authorization.js';
import { productionStatuses } from '#lib/server/db/schema/production.js';
import { listProductions } from '#lib/server/production/production-list.js';
import { listDateRanges } from '#lib/config.js';

/**
 * Staff: every production, at every status (#3112). `event.read`, the guard the
 * Events list's Productions view had.
 */
export const getStaffProductions = query(
	z.object({
		status: z.enum(productionStatuses).optional(),
		needsActs: z.boolean().optional(),
		range: z.enum(listDateRanges).optional(),
		from: z.iso.date().optional(),
		to: z.iso.date().optional(),
		page: z.number().int().positive().optional()
	}),
	async ({ page, ...filters }) => {
		await requireCapability('event.read');
		const { rows, pagination } = await listProductions(filters, { page: page ?? 1, pageSize: 50 });
		return {
			rows: rows.map((r) => ({
				id: r.id,
				status: r.status,
				projectId: r.projectId,
				name: r.listing?.title ?? r.name,
				startsAt: r.listing?.startsAt ?? r.startsAt,
				endsAt: r.listing?.endsAt ?? null,
				venueName: r.venueName,
				listing: r.listing ? { id: r.listing.id, status: r.listing.status } : null
			})),
			pagination
		};
	}
);
