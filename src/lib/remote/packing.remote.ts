import { z } from 'zod';
import { query, form } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import { mapDomainError } from '$lib/server/errors';
import { getMembers } from '$lib/server/band/band-service';
import {
	getPackingList,
	saveOwnItems,
	saveItemsFor,
	savePackingSettings,
	claimItem,
	releaseItem,
	assignItem,
	setPacked,
	resetPacked,
	PackingAlreadyClaimedError
} from '$lib/server/band/packing-service';
import { packingItemsDraftSchema } from '$lib/types/packing';
import { PACKING_NOTES_MAX } from '$lib/config';

/**
 * The band packing list — see `/band/[slug]/packing`.
 *
 * **Three verbs, three guards, and the split is in the signatures rather than a
 * role check**: `savePackingItems` takes no owner, `claimPackingItem` no
 * assignee. Packing and resetting are guarded at `member` on purpose — not an
 * oversight to tighten later. Rationale: docs/specs/packing-list-spec.md
 */

const bandIdField = z.string().min(1);
const itemIdField = z.string().min(1);

/**
 * The rows arrive as JSON in one hidden field, the shape `LineupEditor`
 * established: `FormData` cannot express an array of objects. The parse is
 * inside the handler, not the schema, because a `.transform()` in a `form()`
 * schema breaks `fields` inference.
 */
const itemsField = z.string();

function parseItems(raw: string) {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = packingItemsDraftSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

/**
 * The packing page's one load-bearing query.
 *
 * `custom/no-concurrent-remote-queries` rules out fanning queries out of the
 * component, and past kit 2.64 that stops the page rendering at all.
 * `allowStaff` lets a staffer advancing a show read what a band brings; it
 * returns `role: 'staff'`, so `isOnRoster` is false and they cannot tick a box.
 */
export const getBandPackingPage = query(bandIdField, async (bandId) => {
	const {
		user,
		group: band,
		role
	} = await requireGroupRole({ id: bandId }, 'member', { allowStaff: true });

	const canManage = role === 'owner' || role === 'admin';

	const [list, members] = await Promise.all([getPackingList(band.id), getMembers(band.id)]);

	return {
		bandId: band.id,
		bandName: band.name,
		list,
		roster: members
			.filter((m) => m.status === 'active')
			.map((m) => ({
				// The band's word for who this is — the member's alias when they set
				// one. `getMembers` already made that choice and `getPackingList`
				// coalesces the same pair, so re-deriving it here is how the two drift.
				userId: m.userId,
				name: m.member.title ?? 'Member',
				role: m.role
			})),
		canManage,
		viewerId: user.id,
		isStaffViewer: role === 'staff',
		/** Ticking and claiming are roster verbs, so staff get neither. */
		isOnRoster: role !== 'staff'
	};
});

/**
 * A member replacing their own rows.
 *
 * No owner field, deliberately — see the module comment. The save is a diff in
 * the service, so `packed`, `assignedUserId` and `promotedAt` survive an edit.
 */
export const savePackingItems = form(
	z.object({ bandId: bandIdField, items: itemsField }),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
		const items = parseItems(data.items);
		if (!items) return { success: false, message: 'That list could not be read.' };

		try {
			await saveOwnItems(band.id, user.id, items);
		} catch (err) {
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * An owner or admin replacing somebody else's rows, or the band's shared crate.
 *
 * An empty `targetUserId` means the shared set — the merch tub and the spare
 * stands, which is why it is admin-only: there is no member whose own crate
 * it is.
 */
export const savePackingItemsFor = form(
	z.object({ bandId: bandIdField, targetUserId: z.string().optional(), items: itemsField }),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		const items = parseItems(data.items);
		if (!items) return { success: false, message: 'That list could not be read.' };

		try {
			await saveItemsFor(band.id, data.targetUserId || null, items);
		} catch (err) {
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/** The band-level half: the note nobody outside the band ever reads. */
export const savePackingNotes = form(
	z.object({ bandId: bandIdField, notes: z.string().trim().max(PACKING_NOTES_MAX).optional() }),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			await savePackingSettings(band.id, { notes: data.notes ?? null });
		} catch (err) {
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * "I'll bring it."
 *
 * **Takes no assignee** — the service writes the guard's user, so no payload
 * puts a row on somebody else. `PackingAlreadyClaimedError` is caught here
 * rather than mapped to a 422: the honest answer to two people tapping this at
 * once is who got there first, not an error page.
 */
export const claimPackingItem = form(
	z.object({ bandId: bandIdField, itemId: itemIdField }),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');

		try {
			await claimItem(band.id, user.id, data.itemId);
		} catch (err) {
			if (err instanceof PackingAlreadyClaimedError) {
				await getBandPackingPage(band.id).refresh();
				return { success: false, message: err.message };
			}
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/** Handing back a row you had claimed. Scoped to your own assignment. */
export const releasePackingItem = form(
	z.object({ bandId: bandIdField, itemId: itemIdField }),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
		try {
			await releaseItem(band.id, user.id, data.itemId);
		} catch (err) {
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * An owner or admin putting a row on somebody, or taking it off them.
 *
 * An empty `toUserId` unassigns — which is also how an admin releases a row
 * somebody else claimed, since `releasePackingItem` only ever touches the
 * caller's own.
 */
export const assignPackingItem = form(
	z.object({ bandId: bandIdField, itemId: itemIdField, toUserId: z.string().optional() }),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			await assignItem(band.id, user.id, data.itemId, data.toUserId || null);
		} catch (err) {
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * Tick or untick one row. Guarded at `member`: ownership governs what the band
 * brings, not who may carry a box.
 *
 * `packed` is a `'0' | '1'` enum rather than a boolean because kit's boolean
 * coercion keys off a `b:` field-name prefix, which a hidden input driven by a
 * button does not carry — and the failure surfaces as the boolean's own error.
 */
export const setPackingItemPacked = form(
	z.object({ bandId: bandIdField, itemId: itemIdField, packed: z.enum(['0', '1']) }),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
		try {
			await setPacked(band.id, user.id, data.itemId, data.packed === '1');
		} catch (err) {
			mapDomainError(err);
		}
		await getBandPackingPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * Clear every tick for the next load-in.
 *
 * `member`, the same guard as ticking, because it is the same verb at the same
 * lifetime: the person who walks the list at load-out is the person who clears
 * it before the next one. Assignments survive — see `resetPacked`.
 */
export const resetPackingList = form(z.object({ bandId: bandIdField }), async (data) => {
	const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
	let cleared = 0;
	try {
		({ cleared } = await resetPacked(band.id, user.id));
	} catch (err) {
		mapDomainError(err);
	}
	await getBandPackingPage(band.id).refresh();
	return { success: true, cleared };
});
