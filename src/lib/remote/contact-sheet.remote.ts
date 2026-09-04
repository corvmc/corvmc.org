import { z } from 'zod';
import { query, form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireCapability } from '$lib/server/authorization';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import {
	getContactSheetDisclosure,
	issueContactSheetLink,
	revokeContactSheetLink,
	saveContactSheet
} from '$lib/server/directory/contact-sheet-service';

/**
 * `/act/{token}` — the one surface an external act can reach.
 *
 * **Nothing here is guarded by a session, and that is deliberate.** The act has
 * no account; the token authorizes editing exactly one entry and nothing else.
 * `requireUser` would refuse the only caller these exist for, and reaching for
 * better-auth's magic-link plugin would add a passwordless path to the real auth
 * system to solve a data-entry problem.
 *
 * The token is therefore the whole of the authorization, which is why the
 * service resolves it — expiry, revocation and existence — on **every** call
 * rather than trusting a prior resolve. A remote function takes its arguments
 * from a client-supplied payload, so "the caller already checked" is never
 * something these can assume.
 *
 * The two staff exports at the bottom are the other half: issuing and revoking,
 * both `directory.shareContactSheet`.
 */

const tokenField = z.string().min(1);

/**
 * What the act sees: its own record, and what CMC holds about it.
 *
 * The same token is the subject-rights surface — they have no account, so this
 * is the only door they have, and it costs nothing because the door exists.
 */
export const getContactSheet = query(tokenField, async (token) => {
	try {
		const sheet = await getContactSheetDisclosure(token);
		return {
			// The name is shown but never editable — staff own it, because it
			// appears on posters and in settlement records.
			name: sheet.name,
			bio: sheet.bio,
			hometown: sheet.hometown,
			url: sheet.links?.[0]?.url ?? null
		};
	} catch (err) {
		mapDomainError(err);
	}
});

export const saveContactSheetForm = form(
	z.object({
		token: tokenField,
		// No `name`. Not "ignored if present" — absent from the schema, so a
		// submitted one is dropped before any handler could act on it.
		bio: z.string().max(LONG_TEXT_MAX).optional(),
		hometown: z.string().max(SHORT_TEXT_MAX).optional(),
		url: z.string().url('Enter a full URL, or leave it blank').optional().or(z.literal('')),
		bookingName: z.string().max(SHORT_TEXT_MAX).optional(),
		bookingEmail: z
			.string()
			.email('Enter a valid email, or leave it blank')
			.optional()
			.or(z.literal('')),
		bookingPhone: z.string().max(SHORT_TEXT_MAX).optional()
	}),
	async (data) => {
		try {
			await saveContactSheet(data.token, {
				bio: data.bio || null,
				hometown: data.hometown || null,
				url: data.url || null,
				contact: {
					bookingName: data.bookingName || null,
					bookingEmail: data.bookingEmail || null,
					bookingPhone: data.bookingPhone || null
				}
			});
			return { success: true };
		} catch (err) {
			// An expired or revoked link is a 404 and an ordinary answer, not a
			// fault — the act followed a link that stopped being valid.
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const sendContactSheetLink = form(
	z.object({
		entryId: z.string().min(1),
		email: z.string().email('Where should the link go?')
	}),
	async (data) => {
		const staff = await requireCapability('directory.shareContactSheet');
		const { token } = await issueContactSheetLink(data.entryId, data.email, staff.id);
		// Returned rather than emailed here: the send belongs to the notification
		// layer, and staff need the URL anyway when an act asks for it again.
		return { success: true, token };
	}
);

export const revokeContactSheetLinkForm = form(
	z.object({ entryId: z.string().min(1) }),
	async (data) => {
		await requireCapability('directory.shareContactSheet');
		await revokeContactSheetLink(data.entryId);
		return { success: true };
	}
);
