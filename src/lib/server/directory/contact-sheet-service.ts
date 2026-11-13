import { db } from '#lib/server/db/index.js';
import { directoryEntryLink } from '#lib/server/db/schema/directory-link.js';
import { directoryEntry } from '#lib/server/db/schema/directory.js';
import { and, eq, isNull } from 'drizzle-orm';
import { requireCapability } from '#lib/server/authorization.js';
import { DomainError } from '#lib/server/domain-error.js';
import { sanitizeBio } from '#lib/utils/markdown.js';
import { writeActContactUnguarded, type ContactData } from './contact-service';
import { performerFor } from '#lib/server/party/organization-service.js';
import type { ProfileLink } from '#lib/server/db/schema/authentication.js';
import * as publicEnv from '$app/env/public';
import { outboxMessage } from '#lib/server/db/schema/outbox.js';
import { emailRow } from '#lib/server/outbox/outbox-row.js';
import { standaloneEmail } from '#lib/server/notification/dispatcher.js';
import type { StandaloneEmailContent } from '#lib/types/notification-email.js';

/**
 * The contact-sheet link, and the only surface an external act can reach.
 *
 * Everything here is either staff-guarded or token-authorized, and the two never
 * mix: `issueContactSheetLink` and `revokeContactSheetLink` require
 * `directory.shareContactSheet`; `resolveContactSheetToken` and `saveContactSheet` take a
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

/** Where an act fills its contact sheet in. Staff copy it when the act asks again. */
export function contactSheetUrl(token: string): string {
	return `${publicEnv.PUBLIC_SITE_URL ?? 'https://corvmc.org'}/act/${token}`;
}

/** The outbox subject a link's email is filed under: the link row, so each send has its own. */
export const contactSheetSubject = (linkId: string) => ({
	type: 'directory_entry_link',
	id: linkId
});

/**
 * Issue a link for one act, to one address, and email it (#2781).
 *
 * Any live link for that entry is revoked first. Two live links would mean an
 * address staff had deliberately cut off could still be used by whoever holds
 * the older one, which is the opposite of what revoking is for. The revoke, the
 * new link and its email commit in one batch; the outbox sends the email.
 */
export async function issueContactSheetLink(
	entryId: string,
	email: string,
	actorId: string
): Promise<{ token: string; url: string; outboxId: string }> {
	await requireCapability('directory.shareContactSheet');

	const [entry] = await db
		.select({ name: directoryEntry.name })
		.from(directoryEntry)
		.where(eq(directoryEntry.id, entryId))
		.limit(1);

	const to = email.toLowerCase().trim();
	const link = {
		id: crypto.randomUUID(),
		token: crypto.randomUUID(),
		entryId,
		email: to,
		expiresAt: expiresAt(),
		createdById: actorId
	};
	const url = contactSheetUrl(link.token);
	const mail = emailRow(
		standaloneEmail(
			'contact_sheet.link',
			to,
			contactSheetEmail(entry?.name ?? null, url, link.expiresAt)
		),
		contactSheetSubject(link.id)
	);

	await db.batch([
		db
			.update(directoryEntryLink)
			.set({ revokedAt: new Date() })
			.where(and(eq(directoryEntryLink.entryId, entryId), isNull(directoryEntryLink.revokedAt))),
		db.insert(directoryEntryLink).values(link),
		db.insert(outboxMessage).values(mail)
	]);

	return { token: link.token, url, outboxId: mail.id };
}

function contactSheetEmail(
	actName: string | null,
	url: string,
	until: Date
): StandaloneEmailContent {
	const expires = until.toLocaleDateString('en-US', {
		month: 'long',
		day: 'numeric',
		timeZone: 'America/Los_Angeles'
	});
	return {
		subject: 'Your contact sheet for Corvallis Music Collective',
		heading: actName ? `Contact sheet for ${actName}` : 'Your contact sheet',
		paragraphs: [
			{ text: 'Add your bio, links and booking contact so we can reach you about the show.' },
			{ text: `The link works until ${expires}. No account is needed.` }
		],
		cta: { label: 'Open contact sheet', url }
	};
}

export async function revokeContactSheetLink(entryId: string): Promise<void> {
	await requireCapability('directory.shareContactSheet');

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
 * The person is written as a `self_entered` contact at the act's performer
 * organization, which is the whole point of this path: CMC then holds what the
 * act chose to give rather than what staff transcribed. `writeActContactUnguarded`
 * is the deliberate exception to the contact service's staff guard, because the
 * act has no session to check.
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

	await writeActContactUnguarded(await performerFor(link.entryId), data.contact);

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
