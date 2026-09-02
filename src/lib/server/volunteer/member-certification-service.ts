import { db } from '$lib/server/db';
import {
	memberCertification,
	volunteerCertification,
	volunteerRole,
	volunteerRoleCertification,
	volunteerShift,
	volunteerSignup
} from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { getRequirementsForRoles } from './volunteer-certification-service';
import { clubToday, CERT_EXPIRY_WARNING_DAYS, DEFAULT_TIMEZONE } from '$lib/config';
import type { MemberCertification } from '$lib/server/db/schema/volunteer';

// ---------------------------------------------------------------------------
// Held certifications
// ---------------------------------------------------------------------------
// Append-only: a renewal inserts a new row rather than updating the old one, so
// "was this member cleared on the night of the incident?" stays answerable. The
// table has no unique constraint on (userId, certificationId) for exactly that
// reason, and no status column — every state below is derived from dates.
// ---------------------------------------------------------------------------

const TZ = DEFAULT_TIMEZONE;

export class MemberCertificationNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Certification record not found');
	}
}

export class MemberCertificationValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export class MemberCertificationNotDeletableError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super(
			'This record can only be deleted by the staffer who created it, on the day they created it. ' +
				'Revoke it instead — that keeps the record of the period it covered.'
		);
	}
}

export type CertificationState = 'current' | 'expiring' | 'expired' | 'revoked';

/** A calendar date at noon club time, matching how hour logs anchor dates. */
function atNoon(dateStr: string): Date {
	return buildDateInTz(dateStr, '12:00', TZ);
}

/**
 * Whether a held certification was in force on a given instant.
 *
 * The asymmetry is deliberate and easy to get backwards:
 *
 * - `expiresAt >= at` — a card is valid **through** its expiry date.
 * - `revokedAt > at` — a clearance pulled **on** the day of a shift was not in
 *   force for that shift.
 */
export function wasHeldOn(
	row: Pick<MemberCertification, 'grantedAt' | 'expiresAt' | 'revokedAt'>,
	at: Date
): boolean {
	if (row.grantedAt > at) return false;
	if (row.expiresAt && row.expiresAt < at) return false;
	if (row.revokedAt && row.revokedAt <= at) return false;
	return true;
}

/** The same predicate as SQL, for queries that filter in the database. */
function heldOnSql(at: Date) {
	const ts = Math.floor(at.getTime() / 1000);
	return and(
		lte(memberCertification.grantedAt, at),
		or(isNull(memberCertification.expiresAt), gte(memberCertification.expiresAt, at)),
		// `>` not `>=`: revoked on the day means not in force that day. Written as
		// a raw comparison against unix seconds because a bound Date inside a raw
		// fragment reaches D1 as an object and is rejected.
		or(isNull(memberCertification.revokedAt), sql`${memberCertification.revokedAt} > ${ts}`)
	);
}

export function certificationState(
	row: Pick<MemberCertification, 'grantedAt' | 'expiresAt' | 'revokedAt'>,
	today = atNoon(clubToday())
): CertificationState {
	if (row.revokedAt && row.revokedAt <= today) return 'revoked';
	if (row.expiresAt && row.expiresAt < today) return 'expired';
	if (row.expiresAt) {
		const warnFrom = new Date(today.getTime() + CERT_EXPIRY_WARNING_DAYS * 86_400_000);
		if (row.expiresAt <= warnFrom) return 'expiring';
	}
	return 'current';
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Grant a certification to a member. Renewals call this again — the new row is
 * the current one, and the old row keeps its dates as the record of the window
 * it covered.
 *
 * `expiresAt` is stamped **here**, from the catalog's `validityMonths` as it
 * stands today. Editing the catalog later cannot reach back and expire cards
 * that were validly issued under the old rule.
 */
export async function grantCertification(data: {
	userId: string;
	certificationId: string;
	/** YYYY-MM-DD in club time. */
	grantedOn: string;
	reference?: string | null;
	notes?: string | null;
	grantedByUserId: string;
}): Promise<MemberCertification> {
	const [cert] = await db
		.select({ validityMonths: volunteerCertification.validityMonths })
		.from(volunteerCertification)
		.where(eq(volunteerCertification.id, data.certificationId))
		.limit(1);

	if (!cert) throw new MemberCertificationValidationError('That certification no longer exists.');

	const grantedAt = atNoon(data.grantedOn);
	if (grantedAt > atNoon(clubToday())) {
		throw new MemberCertificationValidationError(
			'A certification cannot be granted in the future.'
		);
	}

	// Month arithmetic on the calendar date, then re-anchored at noon: adding
	// milliseconds would drift across a DST boundary and land an expiry an hour
	// either side of midnight.
	//
	// The day is clamped to the target month's length. Date.UTC overflows a short
	// month — a six-month card granted on 31 August would roll February 31 into
	// March 3 and be honoured three days past what the catalog promised, always
	// in the permissive direction.
	let expiresAt: Date | null = null;
	if (cert.validityMonths) {
		const [y, m, d] = data.grantedOn.split('-').map(Number);
		const targetMonth = m - 1 + cert.validityMonths;
		const lastDayOfTarget = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
		const target = new Date(Date.UTC(y, targetMonth, Math.min(d, lastDayOfTarget)));
		expiresAt = atNoon(target.toISOString().slice(0, 10));
	}

	const [row] = await db
		.insert(memberCertification)
		.values({
			userId: data.userId,
			certificationId: data.certificationId,
			grantedAt,
			expiresAt,
			grantedByUserId: data.grantedByUserId,
			reference: data.reference?.trim() || null,
			notes: data.notes?.trim() || null
		})
		.returning();

	return row;
}

/**
 * Pull a clearance. The row stays — the window it covered is history, and that
 * history is the point of the table.
 */
export async function revokeCertification(
	id: string,
	revokedByUserId: string,
	reason: string
): Promise<MemberCertification> {
	const trimmed = reason.trim();
	if (!trimmed) {
		throw new MemberCertificationValidationError('Give a reason — the next staffer needs to know.');
	}

	const [row] = await db
		.update(memberCertification)
		.set({
			revokedAt: new Date(),
			revokedReason: trimmed,
			revokedByUserId,
			updatedAt: new Date()
		})
		.where(and(eq(memberCertification.id, id), isNull(memberCertification.revokedAt)))
		.returning();

	if (!row) throw new MemberCertificationNotFoundError();
	return row;
}

/**
 * Hard delete, for the typo case only — wrong member, wrong certification, never
 * relied on. Restricted to the same staffer on the same day, because after that
 * you cannot tell "was never true" from "is no longer true", and only the first
 * is safe to erase.
 */
export async function deleteCertificationRecord(
	id: string,
	byUserId: string
): Promise<MemberCertification> {
	const [row] = await db
		.select()
		.from(memberCertification)
		.where(eq(memberCertification.id, id))
		.limit(1);

	if (!row) throw new MemberCertificationNotFoundError();

	const createdOn = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(row.createdAt);
	if (row.grantedByUserId !== byUserId || createdOn !== clubToday()) {
		throw new MemberCertificationNotDeletableError();
	}

	const [deleted] = await db
		.delete(memberCertification)
		.where(eq(memberCertification.id, id))
		.returning();

	return deleted;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface HeldCertification extends MemberCertification {
	certificationName: string;
	issuedBy: string | null;
	state: CertificationState;
	grantedByName: string | null;
}

/** Everything one member holds, newest grant first. Includes lapsed and revoked. */
export async function listForUser(userId: string): Promise<HeldCertification[]> {
	const rows = await db
		.select({
			record: memberCertification,
			certificationName: volunteerCertification.name,
			issuedBy: volunteerCertification.issuedBy,
			grantedByName: sql<string | null>`(
				select "name" from "user" gb where gb."id" = ${memberCertification.grantedByUserId}
			)`
		})
		.from(memberCertification)
		.innerJoin(
			volunteerCertification,
			eq(volunteerCertification.id, memberCertification.certificationId)
		)
		.where(eq(memberCertification.userId, userId))
		.orderBy(desc(memberCertification.grantedAt));

	const today = atNoon(clubToday());
	return rows.map((r) => ({
		...r.record,
		certificationName: r.certificationName,
		issuedBy: r.issuedBy,
		grantedByName: r.grantedByName,
		state: certificationState(r.record, today)
	}));
}

/**
 * The certification ids a member currently holds — the set the shift-claim gate
 * checks against. Takes the date so "can they claim a shift three weeks out"
 * asks about the shift date, not today.
 */
export async function heldCertificationIds(userId: string, at = new Date()): Promise<Set<string>> {
	const rows = await db
		.select({ id: memberCertification.certificationId })
		.from(memberCertification)
		.where(and(eq(memberCertification.userId, userId), heldOnSql(at)));

	return new Set(rows.map((r) => r.id));
}

export interface HeldForGate {
	certificationId: string;
	grantedAt: Date;
	expiresAt: Date | null;
	revokedAt: Date | null;
}

/**
 * Every certification row a member holds, dates included, in one query.
 *
 * The rows rather than a resolved set, because "do they hold this" depends on
 * the date being asked about — a caller checking many shifts at once needs to
 * re-evaluate per shift date without going back to the database each time.
 */
export async function listHeldForGate(userId: string): Promise<HeldForGate[]> {
	return db
		.select({
			certificationId: memberCertification.certificationId,
			grantedAt: memberCertification.grantedAt,
			expiresAt: memberCertification.expiresAt,
			revokedAt: memberCertification.revokedAt
		})
		.from(memberCertification)
		.where(eq(memberCertification.userId, userId));
}

// D1 rejects a statement with more than 100 bound parameters. A page of
// interested members is 50, so this only ever chunks under a much larger caller,
// but the ceiling is the driver's and not worth rediscovering.
const GATE_LOOKUP_CHUNK = 90;

/**
 * The same rows as `listHeldForGate`, for many members at once, keyed by user.
 *
 * For a page of members against one role — "who on this list is actually
 * cleared" — this is the second of two queries, the other being the role's
 * requirements. The per-member alternative is two queries each. Members with no
 * certification rows are absent from the map rather than present and empty; read
 * it with `?? []`.
 */
export async function listHeldForGateMany(userIds: string[]): Promise<Map<string, HeldForGate[]>> {
	const byUser = new Map<string, HeldForGate[]>();
	const unique = [...new Set(userIds)];

	for (let i = 0; i < unique.length; i += GATE_LOOKUP_CHUNK) {
		const rows = await db
			.select({
				userId: memberCertification.userId,
				certificationId: memberCertification.certificationId,
				grantedAt: memberCertification.grantedAt,
				expiresAt: memberCertification.expiresAt,
				revokedAt: memberCertification.revokedAt
			})
			.from(memberCertification)
			.where(inArray(memberCertification.userId, unique.slice(i, i + GATE_LOOKUP_CHUNK)));

		for (const { userId, ...held } of rows) {
			const existing = byUser.get(userId);
			if (existing) existing.push(held);
			else byUser.set(userId, [held]);
		}
	}

	return byUser;
}

/**
 * The pure half of the gate: which of `required` the member did not hold on
 * `at`, given rows already fetched. Lets a page evaluate many shifts against one
 * round trip instead of two queries per shift.
 */
export function missingFrom(
	required: { id: string; name: string }[],
	held: HeldForGate[],
	at: Date
): { id: string; name: string }[] {
	return required.filter(
		(req) => !held.some((h) => h.certificationId === req.id && wasHeldOn(h, at))
	);
}

/**
 * Which of a role's required certifications a member is missing, as of a date.
 * Empty means they may claim. Used by the shift gate and by the member-facing
 * "why can't I claim this" copy.
 *
 * Two queries — fine for a single check like claiming. For a page of shifts use
 * `getRequirementsForRoles` + `listHeldForGate` + `missingFrom` instead.
 */
export async function missingRequirements(
	userId: string,
	roleId: string,
	at = new Date()
): Promise<{ id: string; name: string }[]> {
	const required = await db
		.select({ id: volunteerCertification.id, name: volunteerCertification.name })
		.from(volunteerRoleCertification)
		.innerJoin(
			volunteerCertification,
			eq(volunteerCertification.id, volunteerRoleCertification.certificationId)
		)
		.where(eq(volunteerRoleCertification.volunteerRoleId, roleId))
		.orderBy(asc(volunteerCertification.name));

	if (required.length === 0) return [];

	const held = await heldCertificationIds(userId, at);
	return required.filter((r) => !held.has(r.id));
}

/**
 * Whether each member actually held their role's clearances **on the day they
 * worked** — the audit, as opposed to the gate.
 *
 * These are two different questions against two different dates, and only the
 * first was ever asked. `claimShift` checks as of the shift's date, which stops
 * somebody committing to work they are not cleared for. But a card can lapse
 * between claiming and working, and hour-log review re-checked nothing at all:
 * the hours were approved and the record showed a cleared volunteer.
 *
 * `member_certification` is append-only precisely so "was their card current on
 * the night they worked?" stays answerable. It was answerable and never asked.
 *
 * Two queries whatever the row count, matching the shift board's
 * `getRequirementsForRoles` + `listHeldForGate` + `missingFrom` shape. Keyed by
 * row id, and a row whose role requires nothing simply has no entry.
 */
export async function auditClearances(
	rows: { id: string; userId: string; volunteerRoleId: string; workedOn: Date }[]
): Promise<Map<string, { id: string; name: string }[]>> {
	const gaps = new Map<string, { id: string; name: string }[]>();
	if (rows.length === 0) return gaps;

	const [requirements, held] = await Promise.all([
		getRequirementsForRoles([...new Set(rows.map((r) => r.volunteerRoleId))]),
		listHeldForGateMany([...new Set(rows.map((r) => r.userId))])
	]);

	for (const row of rows) {
		const required = requirements.get(row.volunteerRoleId) ?? [];
		if (required.length === 0) continue;
		const missing = missingFrom(required, held.get(row.userId) ?? [], row.workedOn);
		if (missing.length > 0) gaps.set(row.id, missing);
	}

	return gaps;
}

export interface ClearanceRow {
	/** The grant row, so the list can revoke without a second lookup. */
	id: string;
	userId: string;
	member: MemberRef;
	certificationId: string;
	certificationName: string;
	grantedAt: Date;
	expiresAt: Date | null;
	state: CertificationState;
}

/**
 * The clearances view: who is current, who is expiring, who has lapsed.
 *
 * Only the newest grant per (member, certification) counts — a renewal
 * supersedes its predecessor for "do they hold this now", even though both rows
 * stay for the historical question.
 */
export async function listClearances(
	filters: { certificationId?: string; state?: CertificationState } = {}
): Promise<ClearanceRow[]> {
	const rows = await db
		.select({
			id: memberCertification.id,
			userId: memberCertification.userId,
			member: memberRefColumns(),
			certificationId: memberCertification.certificationId,
			certificationName: volunteerCertification.name,
			grantedAt: memberCertification.grantedAt,
			expiresAt: memberCertification.expiresAt,
			revokedAt: memberCertification.revokedAt
		})
		.from(memberCertification)
		.innerJoin(user, eq(user.id, memberCertification.userId))
		.innerJoin(
			volunteerCertification,
			eq(volunteerCertification.id, memberCertification.certificationId)
		)
		.where(
			and(
				isNull(user.deletedAt),
				filters.certificationId
					? eq(memberCertification.certificationId, filters.certificationId)
					: undefined
			)
		)
		.orderBy(asc(user.name), desc(memberCertification.grantedAt));

	// Newest grant per (member, certification) wins.
	const newest = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const key = `${row.userId}:${row.certificationId}`;
		if (!newest.has(key)) newest.set(key, row);
	}

	const today = atNoon(clubToday());
	const out = [...newest.values()].map((r) => ({
		id: r.id,
		userId: r.userId,
		member: toMemberRef(r.member),
		certificationId: r.certificationId,
		certificationName: r.certificationName,
		grantedAt: r.grantedAt,
		expiresAt: r.expiresAt,
		state: certificationState(r, today)
	}));

	return filters.state ? out.filter((r) => r.state === filters.state) : out;
}

/** Flags for a page of hour logs, so the review queue doesn't N+1. */
export async function flagUnclearedLogs(
	logs: { id: string; userId: string; volunteerRoleId: string; workedOn: Date }[]
): Promise<Set<string>> {
	const flagged = new Set<string>();
	if (logs.length === 0) return flagged;

	const roleIds = [...new Set(logs.map((l) => l.volunteerRoleId))];
	const required = await db
		.select({
			roleId: volunteerRoleCertification.volunteerRoleId,
			certificationId: volunteerRoleCertification.certificationId
		})
		.from(volunteerRoleCertification)
		.where(inArray(volunteerRoleCertification.volunteerRoleId, roleIds));

	if (required.length === 0) return flagged;

	const requiredByRole = new Map<string, string[]>();
	for (const r of required) {
		requiredByRole.set(r.roleId, [...(requiredByRole.get(r.roleId) ?? []), r.certificationId]);
	}

	const userIds = [...new Set(logs.map((l) => l.userId))];
	const held = await db
		.select({
			userId: memberCertification.userId,
			certificationId: memberCertification.certificationId,
			grantedAt: memberCertification.grantedAt,
			expiresAt: memberCertification.expiresAt,
			revokedAt: memberCertification.revokedAt
		})
		.from(memberCertification)
		.where(inArray(memberCertification.userId, userIds));

	for (const log of logs) {
		const need = requiredByRole.get(log.volunteerRoleId);
		if (!need?.length) continue;

		const ok = need.every((certId) =>
			held.some(
				(h) => h.userId === log.userId && h.certificationId === certId && wasHeldOn(h, log.workedOn)
			)
		);
		if (!ok) flagged.add(log.id);
	}

	return flagged;
}

// ---------------------------------------------------------------------------
// The clearance question the schedule actually asks
// ---------------------------------------------------------------------------

export interface LapsingBeforeShift {
	userId: string;
	member: MemberRef;
	certificationId: string;
	certificationName: string;
	expiresAt: Date;
	shiftId: string;
	roleName: string;
	startsAt: Date;
}

/**
 * People whose clearance runs out before a shift they are already on.
 *
 * The clearances page answers "who expires soon", which is a list nobody is obliged to
 * act on. This answers the version with a deadline attached: somebody is rostered for
 * Saturday, the card their role requires lapses on Friday, and the gate — which is
 * evaluated as of the shift's date — will be right to refuse them while the roster still
 * says they are booked.
 *
 * Deliberately narrow: only live signups on upcoming, uncancelled shifts, and only where
 * the role genuinely requires that certification. A card expiring next month that gates
 * nothing anybody is booked for is not this list's business — it is the clearances page's.
 *
 * The expiry test runs in SQL rather than through `missingFrom` because the question is
 * one row per (person, certification, shift) and the answer is a comparison of two
 * timestamps; pulling every held row into JS to filter it would be the same logic further
 * from the data. `wasHeldOn`'s other two clauses are here too: a revoked card is already
 * gone, and one granted after the shift never covered it.
 */
export async function listLapsingBeforeRosteredShift(
	now = new Date()
): Promise<LapsingBeforeShift[]> {
	const rows = await db
		.select({
			userId: memberCertification.userId,
			member: memberRefColumns(),
			certificationId: volunteerCertification.id,
			certificationName: volunteerCertification.name,
			expiresAt: memberCertification.expiresAt,
			shiftId: volunteerShift.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, volunteerShift.volunteerRoleId))
		.innerJoin(
			volunteerRoleCertification,
			eq(volunteerRoleCertification.volunteerRoleId, volunteerShift.volunteerRoleId)
		)
		.innerJoin(
			volunteerCertification,
			eq(volunteerCertification.id, volunteerRoleCertification.certificationId)
		)
		.innerJoin(
			memberCertification,
			and(
				eq(memberCertification.userId, volunteerSignup.userId),
				eq(memberCertification.certificationId, volunteerRoleCertification.certificationId)
			)
		)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				inArray(volunteerSignup.status, ['claimed', 'confirmed']),
				isNull(volunteerShift.cancelledAt),
				gte(volunteerShift.startsAt, now),
				isNull(memberCertification.revokedAt),
				lte(memberCertification.grantedAt, volunteerShift.startsAt),
				isNotNull(memberCertification.expiresAt),
				lt(memberCertification.expiresAt, volunteerShift.startsAt)
			)
		)
		.orderBy(asc(volunteerShift.startsAt));

	return (
		rows
			.filter((r): r is typeof r & { expiresAt: Date } => r.expiresAt !== null)
			// A clearance can only lapse *before* a shift that has a date. An
			// unscheduled work order has nothing to lapse against, and the SQL
			// comparison against `starts_at` already dropped those.
			.filter((r): r is typeof r & { startsAt: Date } => r.startsAt !== null)
			.map((r) => ({ ...r, member: toMemberRef(r.member) }))
	);
}
