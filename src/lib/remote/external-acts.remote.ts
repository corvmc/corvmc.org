import { z } from 'zod';
import { query, form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireStaff } from '$lib/server/authorization';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import {
	claimExternalAct,
	createExternalAct,
	listExternalActs
} from '$lib/server/directory/entry-service';

/**
 * External acts — parties CMC has booked that are not members of anything here.
 *
 * **Staff-only, all of it, and there is no member-facing counterpart.** An
 * external act has no page, no slug and no public surface of any kind: it is a
 * `directory_entry` with both owner columns null, forced hidden, reachable only
 * from the staff bands area. That is the point of directory visibility being a
 * member benefit taken to its conclusion — CMC does not host a page for a band
 * with no CMC relationship, and the act already has a presence it chose.
 *
 * Not flagged. These are staff bookkeeping about acts already being booked
 * today, and the risk a flag would manage — a half-built surface reaching
 * members — does not exist when nothing reaches members at all.
 */

export const getStaffExternalActs = query(
	z.object({ search: z.string().optional() }),
	async (filters) => {
		await requireStaff();
		return listExternalActs(filters.search || undefined);
	}
);

export const createStaffExternalAct = form(
	z.object({
		name: z.string().min(1, 'Give the act a name').max(SHORT_TEXT_MAX),
		hometown: z.string().max(SHORT_TEXT_MAX).optional(),
		bio: z.string().max(LONG_TEXT_MAX).optional(),
		/**
		 * Where the act's name should point when it appears on a public bill.
		 * Their Bandcamp, their Linktree, whatever they gave us — public
		 * attribution links out, never in.
		 */
		url: z.string().url('Enter a full URL, or leave it blank').optional().or(z.literal(''))
	}),
	async (data) => {
		await requireStaff();

		const id = await createExternalAct({
			name: data.name,
			hometown: data.hometown || null,
			bio: data.bio || null,
			links: data.url ? [{ label: 'Website', url: data.url }] : null
		});

		return { success: true, id };
	}
);

/**
 * Turn an act into a CMC band, with the member who joined as its owner.
 *
 * Staff-driven, because an external act has nothing a member could find or act
 * on — no page, no link, no notification. Claiming is deliberately a different
 * door from the contact-sheet link that lets an act edit its own details: that
 * one says "keep your record current and stay external", and conflating them
 * would mean an act updating its bio accidentally acquires a membership.
 */
export const claimStaffExternalAct = form(
	z.object({
		entryId: z.string().min(1),
		ownerId: z.string().min(1, 'Pick the member who will own the band')
	}),
	async (data) => {
		await requireStaff();
		try {
			const { slug } = await claimExternalAct(data.entryId, data.ownerId);
			return { success: true, slug };
		} catch (err) {
			// `ActAlreadyClaimedError` is a 409 — two staff on the same act, which
			// is an ordinary race rather than a fault.
			mapDomainError(err);
		}
	}
);
