import { parse as parseCsv } from 'csv-parse/browser/esm/sync';
import { z } from 'zod';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { INVITE_EXPIRY_DAYS, ROSTER_IMPORT_MAX } from '$lib/config';
import { group, groupMember } from '$lib/server/db/schema/group';
import { groupInvite } from '$lib/server/db/schema/group-invite';
import { groupApplication, groupApplicationChoice } from '$lib/server/db/schema/group-application';
import { user } from '$lib/server/db/schema/authentication';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import { captureException } from '$lib/server/sentry';
import { DomainError } from '$lib/server/domain-error';
import type { RosterImportResult } from '$lib/types/roster-import';

export type { RosterImportResult };

/**
 * Staff turning a mailing list (a Zeffy export, usually) into a roster.
 *
 * An address with an account goes straight onto the roster as active: staff
 * are adding people who already paid or signed up elsewhere, so there is no
 * acceptance step. An address without one gets the ordinary emailed invitation.
 */

/** The input could not be read at all — nothing was imported. */
export class RosterImportInputError extends DomainError {
	readonly httpStatus = 422;
}

export interface ParsedRosterImport {
	/** Normalized, valid, first occurrence order. */
	emails: string[];
	/** Each offending line, as typed. */
	invalid: string[];
	/** Repeats of an address already in `emails`. */
	duplicates: number;
}

const emailSchema = z.email();

/** The column holding addresses: a header naming email whose cells most often contain one. */
function emailColumn(rows: string[][]): number {
	const header = rows[0] ?? [];
	const candidates = header
		.map((h, i) => ({ i, name: h.trim().toLowerCase() }))
		.filter((h) => h.name.replace('-', '').includes('email'));
	if (candidates.length === 0) {
		throw new RosterImportInputError('No column in the CSV header mentions “email”.');
	}
	// Zeffy-style exports can carry a consent column ("Email opt-in") beside the
	// address, so the header alone does not decide it.
	const hits = (i: number) => rows.slice(1).filter((r) => r[i]?.includes('@')).length;
	return candidates.reduce((best, c) => (hits(c.i) > hits(best.i) ? c : best)).i;
}

function csvCells(csv: string): string[] {
	let rows: string[][];
	try {
		rows = parseCsv(csv, { bom: true, relax_column_count: true, skip_empty_lines: true });
	} catch {
		throw new RosterImportInputError('That file could not be read as a CSV.');
	}
	const col = emailColumn(rows);
	return rows.slice(1).map((r) => r[col] ?? '');
}

/**
 * Pasted text (one per line, or comma/semicolon separated) and an optional CSV,
 * merged, normalized and deduplicated. Throws only when nothing usable came in
 * or the batch is over `ROSTER_IMPORT_MAX`.
 */
export function parseRosterImport(text: string, csv?: string | null): ParsedRosterImport {
	const raw = [...text.split(/[\n\r,;]+/), ...(csv ? csvCells(csv) : [])]
		.map((s) => s.trim())
		.filter(Boolean);

	const seen = new Set<string>();
	const result: ParsedRosterImport = { emails: [], invalid: [], duplicates: 0 };
	for (const entry of raw) {
		const email = entry.toLowerCase();
		if (!emailSchema.safeParse(email).success) result.invalid.push(entry);
		else if (seen.has(email)) result.duplicates++;
		else {
			seen.add(email);
			result.emails.push(email);
		}
	}

	if (raw.length === 0) throw new RosterImportInputError('Paste some addresses or choose a CSV.');
	if (result.emails.length > ROSTER_IMPORT_MAX) {
		throw new RosterImportInputError(
			`${result.emails.length} addresses is more than the ${ROSTER_IMPORT_MAX} one import takes. Split the list.`
		);
	}
	return result;
}

/** D1 binds at most 100 parameters per statement; ~10 per row here leaves headroom. */
const ROW_CHUNK = 8;
/** One bound parameter per id in an `IN (…)`, beside a couple of others. */
const IN_CHUNK = 80;

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

async function selectChunked<T, R>(items: T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
	const out: R[] = [];
	for (const c of chunks(items, IN_CHUNK)) out.push(...(await run(c)));
	return out;
}

type Statement = Parameters<typeof db.batch>[0][number];

export class RosterImportGroupError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Club or committee not found');
	}
}

/**
 * Apply a parsed import to a club's or committee's roster.
 *
 * A pending roster row, an open application or a live emailed invitation for
 * someone with an account is settled by the add: they are active, and whatever
 * was waiting on them is marked accepted rather than left dangling.
 */
export async function importRoster(
	groupId: string,
	parsed: ParsedRosterImport,
	actor: { id: string; name: string }
): Promise<RosterImportResult> {
	const [target] = await db
		.select({ name: group.name, kind: group.kind })
		.from(group)
		.where(and(eq(group.id, groupId), isNull(group.deletedAt)))
		.limit(1);
	if (!target || target.kind === 'band') throw new RosterImportGroupError();

	const result: RosterImportResult = {
		added: [],
		invited: [],
		alreadyMembers: [],
		alreadyInvited: [],
		invalid: parsed.invalid.map((entry) => ({ entry, reason: 'Not an email address' })),
		duplicates: parsed.duplicates
	};
	const now = new Date();
	const statements: Statement[] = [];

	// --- Addresses with an account -------------------------------------------
	const accounts = await selectChunked(parsed.emails, (c) =>
		db
			.select({ id: user.id, email: user.email, deletedAt: user.deletedAt })
			.from(user)
			.where(inArray(user.email, c))
	);
	const accountByEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a]));
	const live = accounts.filter((a) => !a.deletedAt);
	const rosterRows = await selectChunked(
		live.map((a) => a.id),
		(c) =>
			db
				.select({ id: groupMember.id, userId: groupMember.userId, status: groupMember.status })
				.from(groupMember)
				.where(and(eq(groupMember.groupId, groupId), inArray(groupMember.userId, c)))
	);
	const rosterByUser = new Map(rosterRows.map((r) => [r.userId, r]));

	const toInsert: string[] = [];
	const toActivate: string[] = [];
	const addedUserIds: string[] = [];
	const noAccount: string[] = [];
	for (const email of parsed.emails) {
		const account = accountByEmail.get(email);
		if (!account) {
			noAccount.push(email);
			continue;
		}
		if (account.deletedAt) {
			result.invalid.push({ entry: email, reason: 'Account is deactivated' });
			continue;
		}
		const row = rosterByUser.get(account.id);
		if (row?.status === 'active') {
			result.alreadyMembers.push(email);
			continue;
		}
		if (row) toActivate.push(row.id);
		else toInsert.push(account.id);
		addedUserIds.push(account.id);
		result.added.push(email);
	}

	for (const c of chunks(toInsert, ROW_CHUNK)) {
		statements.push(
			db.insert(groupMember).values(
				c.map((userId) => ({
					groupId,
					userId,
					role: 'member' as const,
					status: 'active' as const,
					invitedById: actor.id
				}))
			)
		);
	}
	for (const c of chunks(toActivate, IN_CHUNK)) {
		statements.push(
			db
				.update(groupMember)
				.set({ status: 'active', updatedAt: now })
				.where(inArray(groupMember.id, c))
		);
	}
	// What was waiting on the people just added: their open applications here,
	// and any emailed invitation addressed to them.
	for (const c of chunks(addedUserIds, IN_CHUNK)) {
		statements.push(
			db
				.update(groupApplicationChoice)
				.set({ status: 'accepted', decidedByUserId: actor.id, decidedAt: now, updatedAt: now })
				.where(
					and(
						eq(groupApplicationChoice.groupId, groupId),
						inArray(groupApplicationChoice.status, ['submitted', 'contacted']),
						inArray(
							groupApplicationChoice.applicationId,
							db
								.select({ id: groupApplication.id })
								.from(groupApplication)
								.where(
									and(inArray(groupApplication.userId, c), isNull(groupApplication.withdrawnAt))
								)
						)
					)
				)
		);
	}
	for (const c of chunks(result.added, IN_CHUNK)) {
		statements.push(
			db
				.update(groupInvite)
				.set({ status: 'accepted', acceptedAt: now })
				.where(
					and(
						eq(groupInvite.groupId, groupId),
						eq(groupInvite.status, 'pending'),
						inArray(groupInvite.email, c)
					)
				)
		);
	}

	// --- Addresses without one ------------------------------------------------
	const liveInvites = await selectChunked(noAccount, (c) =>
		db
			.select({ email: groupInvite.email })
			.from(groupInvite)
			.where(
				and(
					eq(groupInvite.groupId, groupId),
					eq(groupInvite.status, 'pending'),
					gt(groupInvite.expiresAt, now),
					inArray(groupInvite.email, c)
				)
			)
	);
	const invitedAlready = new Set(liveInvites.map((r) => r.email));
	const expires = new Date(now);
	expires.setDate(expires.getDate() + INVITE_EXPIRY_DAYS);
	for (const email of noAccount) {
		(invitedAlready.has(email) ? result.alreadyInvited : result.invited).push(email);
	}
	// An expired invitation is still the `pending` row the partial index guards,
	// so it is refreshed in place — new expiry, same token — exactly as
	// `createInvite` does when an admin re-invites.
	const inviteIndex: number[] = [];
	for (const c of chunks(result.invited, ROW_CHUNK)) {
		inviteIndex.push(statements.length);
		statements.push(
			db
				.insert(groupInvite)
				.values(
					c.map((email) => ({
						email,
						groupId,
						role: 'member' as const,
						position: null,
						invitedById: actor.id,
						status: 'pending' as const,
						expiresAt: expires
					}))
				)
				.onConflictDoUpdate({
					// A literal: see `createInvite` and group-invite-upsert.spec.ts.
					target: [groupInvite.groupId, groupInvite.email],
					targetWhere: sql`status = 'pending'`,
					set: { expiresAt: expires, role: 'member', position: null }
				})
				.returning({ email: groupInvite.email, token: groupInvite.token })
		);
	}

	if (statements.length > 0) {
		// `db.batch`, never `db.transaction()`: the import lands whole or not at all.
		const results = (await db.batch(statements as [Statement, ...Statement[]])) as unknown[];
		if (addedUserIds.length > 0) {
			try {
				await domainEvents.emit('group.members_added', {
					groupId,
					userIds: addedUserIds,
					addedById: actor.id
				});
			} catch (err) {
				captureException(err, { event: 'group.members_added', groupId });
			}
		}
		const invites = inviteIndex.flatMap((i) => results[i] as { email: string; token: string }[]);
		if (invites.length > 0) {
			try {
				await domainEvents.emit('group_invite.bulk_created', {
					groupId,
					groupName: target.name,
					groupKind: target.kind,
					role: 'member',
					invitedByName: actor.name,
					invites
				});
			} catch (err) {
				captureException(err, { event: 'group_invite.bulk_created', groupId });
			}
		}
	}

	await recordAuditEntry({
		action: 'group.roster_imported',
		subject: { type: 'group', id: groupId, label: target.name },
		details: {
			added: result.added.length,
			invited: result.invited.length,
			alreadyMembers: result.alreadyMembers.length,
			alreadyInvited: result.alreadyInvited.length,
			invalid: result.invalid.length
		}
	});

	return result;
}
