import { z } from 'zod';
import { query, form } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import { mapDomainError } from '$lib/server/errors';
import { getMembers } from '$lib/server/band/band-service';
import { listFor } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import {
	getRider,
	saveOwnElements,
	saveElementsFor,
	saveRiderSettings
} from '$lib/server/band/rider-service';
import { riderElementsDraftSchema } from '$lib/types/rider';
import { riderMonitorFormats, RIDER_NOTES_MAX } from '$lib/config';

/**
 * The band tech rider — see `/band/[slug]/rider`.
 *
 * **Two save functions, not one with a flag.** `saveMyRiderElements` takes no
 * owner at all and writes against the guard's user; `saveMemberRiderElements`
 * names one and is guarded at `admin`. That is the split `updateMyBandMembership`
 * and `updateMemberRemote` already draw over `group_member`, and the reason is
 * written there: keying a mutation on a caller-supplied id when the guard
 * already knows the row is how one member ends up editing another. A single
 * function taking an optional `userId` would be exactly that mistake with a
 * flag in front of it.
 */

const bandIdField = z.string().min(1);

/**
 * The rows arrive as JSON in one hidden field, the shape `LineupEditor`
 * established: a remote form's `FormData` cannot express an array of objects,
 * and a request per row is a round-trip explosion. Malformed JSON is a 422
 * rather than a 500 — the parse is inside the handler, not the schema, because
 * a `.transform()` in a `form()` schema breaks `fields` inference.
 */
const elementsField = z.string();

function parseElements(raw: string) {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = riderElementsDraftSchema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

/**
 * The rider page's one load-bearing query.
 *
 * Everything the page needs resolves here, where the caller's role is already
 * known — `custom/no-concurrent-remote-queries` rules out fanning several
 * queries out of the component, and past kit 2.64 doing so stops the page
 * rendering at all.
 *
 * `allowStaff` because a staffer advancing a show has to be able to read a
 * rider for a band they are not in. It comes back as `role: 'staff'`, so
 * `canManage` is false and every control renders read-only.
 */
export const getBandRiderPage = query(bandIdField, async (bandId) => {
	const {
		user,
		group: band,
		role
	} = await requireGroupRole({ id: bandId }, 'member', {
		allowStaff: true
	});
	const canManage = role === 'owner' || role === 'admin';

	const [rider, members, uploads] = await Promise.all([
		getRider(band.id),
		getMembers(band.id),
		// Both slots in one statement. These are the band's own uploaded rider and
		// stage plot — the path for a band that would rather hand over the PDF it
		// already has, which stays first-class beside the structured editor.
		listFor('group', band.id, ['rider', 'stage_plot'])
	]);

	return {
		bandId: band.id,
		bandName: band.name,
		rider,
		roster: members
			.filter((m) => m.status === 'active')
			.map((m) => ({
				userId: m.userId,
				// `title` is the band's word for who this is — the member's alias when
				// they set one, their account name otherwise. `getMembers` already made
				// that choice; re-deriving it here is how the two drift.
				name: m.member.title ?? 'Member',
				role: m.role
			})),
		// `resolveImageUrl`, not `getPublicUrl`: the latter **throws** when
		// `R2_PUBLIC_URL` is unset, which is every local checkout — so one band
		// with an uploaded rider took the whole page down with a 500 rather than
		// rendering the file without a link. A missing URL is a degraded row, not
		// a failed page.
		uploads: uploads.map((u) => ({
			attachmentId: u.attachmentId,
			slot: u.slot,
			url: resolveImageUrl(u.key),
			filename: u.filename,
			contentType: u.contentType
		})),
		canManage,
		viewerId: user.id,
		isStaffViewer: role === 'staff'
	};
});

/**
 * A member replacing their own corner of the rider.
 *
 * No owner field, deliberately — see the module comment.
 */
export const saveMyRiderElements = form(
	z.object({ bandId: bandIdField, elements: elementsField }),
	async (data) => {
		const { user, group: band } = await requireGroupRole({ id: data.bandId }, 'member');
		const elements = parseElements(data.elements);
		if (!elements) return { success: false, message: 'That rider could not be read.' };

		try {
			await saveOwnElements(band.id, user.id, elements);
		} catch (err) {
			mapDomainError(err);
		}
		await getBandRiderPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * An owner or admin replacing somebody else's corner, or the band's shared
 * items.
 *
 * An empty `targetUserId` means the shared set — gear that belongs to the band
 * rather than to a person, which is why it is admin-only: there is no member
 * whose own corner it is.
 */
export const saveMemberRiderElements = form(
	z.object({
		bandId: bandIdField,
		targetUserId: z.string().optional(),
		elements: elementsField
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		const elements = parseElements(data.elements);
		if (!elements) return { success: false, message: 'That rider could not be read.' };

		try {
			await saveElementsFor(band.id, data.targetUserId || null, elements);
		} catch (err) {
			mapDomainError(err);
		}
		await getBandRiderPage(band.id).refresh();
		return { success: true };
	}
);

/**
 * The band-level half: who an engineer should call, the monitor format, and the
 * notes that are not an element.
 *
 * Admin-guarded because none of it belongs to one member.
 */
export const saveRiderDetails = form(
	z.object({
		bandId: bandIdField,
		techContactUserId: z.string().optional(),
		monitorFormat: z.enum(riderMonitorFormats).optional(),
		notes: z.string().trim().max(RIDER_NOTES_MAX).optional()
	}),
	async (data) => {
		const { group: band } = await requireGroupRole({ id: data.bandId }, 'admin');
		try {
			await saveRiderSettings(band.id, {
				techContactUserId: data.techContactUserId || null,
				monitorFormat: data.monitorFormat ?? null,
				notes: data.notes ?? null
			});
		} catch (err) {
			mapDomainError(err);
		}
		await getBandRiderPage(band.id).refresh();
		return { success: true };
	}
);
