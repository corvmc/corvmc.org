import { db } from '$lib/server/db';
import { directoryEntryLink } from '$lib/server/db/schema/directory-link';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { and, eq, isNull } from 'drizzle-orm';
import { requireStaff } from '$lib/server/authorization';
import { DomainError } from '$lib/server/domain-error';
import { sanitizeBio } from '$lib/utils/markdown';
import { writeContactUnguarded, type ContactData } from './contact-service';
import type { ProfileLink } from '$lib/server/db/schema/authentication';

/**
 * The contact-sheet link, and the only surface an external act can reach.
 *
 * Everything here is either staff-guarded or token-authorized, and the two never
 * mix: `issueContactSheetLink` and `revokeContactSheetLink` call
 * `requireStaff()`; `resolveContactSheetToken` and `saveContactSheet` take a
 * token and touch no session at all.
 *
 * **The token is not authentication.** It authorizes editing exactly one entry
 * and nothing else — no session, no account, no `locals.user`. Treating it as a
 * login is the mistake this module is shaped to prevent.
 */

const LINK_EXPIRY_DAYS = 30;

export class ContactSheetLinkInvalidError extends DomainError {
	readonly httpStatus = 404;
	constructor(message = 'This link is not valid any more.') {
		super(message);
		this.name = 'ContactSheetLinkInvalidError';
	}
}

function expiresAt(): Date {
	const d = new Date();
	d.setDate(d.getDate() + LINK_EXPIRY_DAYS);
	return d;
}

/**
 * Issue a link for one act, to one address.
 *
 * Any live link for that entry is revoked first. Two live links would mean an
 * address staff had deliberately cut off could still be used by whoever holds
 * the older one, which is the opposite of what revoking is for.
 */
export async function issueContactSheetLink(
	entryId: string,
	email: string,
	actorId: string
): Promise<{ token: string }> {
	await requireStaff();

	await db
		.update(directoryEntryLink)
		.set({ revokedAt: new Date() })
		.where(and(eq(directoryEntryLink.entryId, entryId), isNull(directoryEntryLink.revokedAt)));

	const [row] = await db
		.insert(directoryEntryLink)
		.values({
			entryId,
			email: email.toLowerCase().trim(),
			expiresAt: expiresAt(),
			createdById: actorId
		})
		.returning({ token: directoryEntryLink.token });

	return { token: row.token };
}

export async function revokeContactSheetLink(entryId: string): Promise<void> {
	await requireStaff();

	await db
		.update(directoryEntryLink)
		.set({ revokedAt: new Date() })
		.where(and(eq(directoryEntryLink.entryId, entryId), isNull(directoryEntryLink.revokedAt)));
}

/**
 * What a token is worth, if anything.
 *
 * **No session is consulted and none is created.** Three ways to be invalid, all
 * answered identically so the response cannot be used to probe which tokens once
 * existed: unknown, revoked, expired.
 */
export async function resolveContactSheetToken(token: string) {
	const [row] = await db
		.select({
			linkId: directoryEntryLink.id,
			entryId: directoryEntryLink.entryId,
			expiresAt: directoryEntryLink.expiresAt,
			revokedAt: directoryEntryLink.revokedAt,
			name: directoryEntry.name,
			bio: directoryEntry.bio,
			hometown: directoryEntry.hometown,
			links: directoryEntry.links
		})
		.from(directoryEntryLink)
		.innerJoin(directoryEntry, eq(directoryEntry.id, directoryEntryLink.entryId))
		.where(eq(directoryEntryLink.token, token))
		.limit(1);

	if (!row) return null;
	if (row.revokedAt) return null;
	if (row.expiresAt <= new Date()) return null;

	return row;
}

export interface ContactSheetData {
	bio?: string | null;
	hometown?: string | null;
	url?: string | null;
	contact: ContactData;
}

/**
 * Save what the act typed about itself.
 *
 * **The name is not editable, and it is not a field this function accepts.**
 * Staff control the canonical name because it appears on posters and in
 * settlement records; renaming is a conversation, not a form. Leaving it out of
 * the parameter type is what makes that structural rather than a check somebody
 * has to remember.
 *
 * The contact rows written here are `self_entered`, which is the whole point of
 * this path — CMC then holds what the act chose to give rather than what staff
 * transcribed. `writeContactUnguarded` is the deliberate exception to the
 * contact service's staff guard, because the act has no session to check.
 */
export async function saveContactSheet(token: string, data: ContactSheetData): Promise<void> {
	const link = await resolveContactSheetToken(token);
	if (!link) throw new ContactSheetLinkInvalidError();

	const links: ProfileLink[] | null = data.url ? [{ label: 'Website', url: data.url }] : null;

	await db
		.update(directoryEntry)
		.set({
			bio: data.bio ? sanitizeBio(data.bio) : null,
			hometown: data.hometown || null,
			links,
			updatedAt: new Date()
		})
		.where(eq(directoryEntry.id, link.entryId));

	await writeContactUnguarded(link.entryId, data.contact, 'self_entered');

	// Recorded after the write, so a link that failed mid-save does not look used.
	await db
		.update(directoryEntryLink)
		.set({ lastUsedAt: new Date() })
		.where(eq(directoryEntryLink.id, link.linkId));
}

/**
 * Everything CMC holds about this act, for the act itself.
 *
 * The same token is the subject-rights surface: they have no account, so this is
 * the only door they have, and it costs nothing because the door already exists.
 * Reads through the contact service's unguarded path for the same reason
 * `saveContactSheet` writes through it — there is no session to check, and the
 * token has already been resolved.
 */
export async function getContactSheetDisclosure(token: string) {
	const link = await resolveContactSheetToken(token);
	if (!link) throw new ContactSheetLinkInvalidError();
	return link;
}
