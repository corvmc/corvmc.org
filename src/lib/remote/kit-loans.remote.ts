import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '#lib/server/authorization.js';
import {
	checkoutKit,
	getKitLoan,
	listKitLoans,
	returnKit
} from '#lib/server/inventory/kit-loan-service.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';

/** Kit loans are loans: the same capability as checking out a single unit (#2725). */
const CAP = 'inventory.manageLoans';

/** Open kits first, for the loans page. */
export const getKitLoans = query(z.void(), async () => {
	await requireCapability(CAP);
	return listKitLoans({ openOnly: true });
});

export const getKitLoanDetail = query(z.string(), async (id) => {
	await requireCapability(CAP);
	const kit = await getKitLoan(id);
	if (!kit) error(404, 'Kit loan not found');
	return kit;
});

export const checkOutKit = form(
	z.object({
		locationId: z.string().min(1),
		userId: z.string().min(1),
		dueDate: z.iso.date().optional().or(z.literal('')),
		notes: z.string().trim().max(1000).optional()
	}),
	async (data) => {
		const staff = await requireCapability(CAP);
		const kit = await checkoutKit({
			locationId: data.locationId,
			userId: data.userId,
			// Noon club time, the house convention for a typed calendar date.
			dueDate: data.dueDate ? buildDateInTz(data.dueDate, '12:00', DEFAULT_TIMEZONE) : null,
			actorId: staff.id,
			notes: data.notes
		});
		void getKitLoans().refresh();
		return { kitLoanId: kit.id, leftBehind: kit.leftBehind.length };
	}
);

export const checkInKit = form(
	z.object({
		kitLoanId: z.string().min(1),
		// No box ticked submits no entry at all.
		returnedLoanIds: z.array(z.string()).default([])
	}),
	async (data) => {
		const staff = await requireCapability(CAP);
		const result = await returnKit(data.kitLoanId, {
			returnedLoanIds: data.returnedLoanIds,
			actorId: staff.id
		});
		void getKitLoanDetail(data.kitLoanId).refresh();
		void getKitLoans().refresh();
		return { closed: result.closed, missing: result.missing.length };
	}
);
