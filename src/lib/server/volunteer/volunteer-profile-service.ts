import { db } from '$lib/server/db';
import {
	volunteerProfile,
	volunteerRole,
	volunteerRoleInterest
} from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, count, eq, isNull, like, or, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { paginate, type PaginationInput, type PaginatedResult } from '$lib/server/db/paginate';
import { ROLE_NAME_SEPARATOR } from './volunteer-interest-service';
import type { MemberRef } from '$lib/types/entity';
import { VOLUNTEER_AVAILABILITY_MAX, VOLUNTEER_NAME_MAX } from '$lib/config';
import type { VolunteerProfile, VolunteerProfileStatus } from '$lib/server/db/schema/volunteer';

// ---------------------------------------------------------------------------
// Volunteer profiles
// ---------------------------------------------------------------------------
// What we know about somebody as a volunteer, as opposed to as a member. Exists
// because of one question — "are you 18 or older?" — whose answer has to be on
// file before anybody claims a shift.
//
// The member owns this row apart from `status`, which only staff move. That
// split is the whole security model here: every self-service mutation is scoped
// to one userId and refuses to touch `isAdult` or `status`, so the one way out
// of `blocked` is a staff action.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class VolunteerProfileNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('You need to sign up to volunteer first');
	}
}

export class VolunteerProfileExistsError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('You have already signed up to volunteer');
	}
}

/**
 * Thrown when a member whose profile is not `active` tries to do something only
 * active volunteers may do. Reachable without the UI — remote functions are
 * directly callable endpoints, and the route gate is a redirect, not a guard.
 */
export class VolunteerProfileBlockedError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super(
			"We need to sort a few things out before you can volunteer — please get in touch and we'll set it up."
		);
	}
}

export class VolunteerProfileValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export class VolunteerAlreadyApprovedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('That volunteer has already been approved');
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ProfileNameInput {
	firstName: string;
	lastName: string;
	pronouns?: string | null;
	phone?: string | null;
}

/** Limits match `/member/account`, which edits the same two `user` columns. */
const PRONOUNS_MAX = 50;
const PHONE_MAX = 30;

function normalizeNames(data: ProfileNameInput) {
	const firstName = data.firstName?.trim() ?? '';
	const lastName = data.lastName?.trim() ?? '';

	if (!firstName) throw new VolunteerProfileValidationError('First name is required');
	if (!lastName) throw new VolunteerProfileValidationError('Last name is required');
	if (firstName.length > VOLUNTEER_NAME_MAX) {
		throw new VolunteerProfileValidationError(
			`Keep your first name under ${VOLUNTEER_NAME_MAX} characters`
		);
	}
	if (lastName.length > VOLUNTEER_NAME_MAX) {
		throw new VolunteerProfileValidationError(
			`Keep your last name under ${VOLUNTEER_NAME_MAX} characters`
		);
	}

	const pronouns = data.pronouns?.trim() ?? '';
	if (pronouns.length > PRONOUNS_MAX) {
		throw new VolunteerProfileValidationError(`Keep pronouns under ${PRONOUNS_MAX} characters`);
	}

	const phone = data.phone?.trim() ?? '';
	if (phone.length > PHONE_MAX) {
		throw new VolunteerProfileValidationError(
			`Keep your phone number under ${PHONE_MAX} characters`
		);
	}

	return { firstName, lastName, pronouns, phone };
}

function normalizeAvailability(availability: string | null | undefined): string | null {
	const trimmed = availability?.trim() ?? '';
	if (trimmed.length > VOLUNTEER_AVAILABILITY_MAX) {
		throw new VolunteerProfileValidationError(
			`Keep this under ${VOLUNTEER_AVAILABILITY_MAX} characters`
		);
	}
	return trimmed || null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface OnboardingInput extends ProfileNameInput {
	isAdult: boolean;
}

/**
 * Create the profile. One-time — the member edits it afterwards through
 * {@link updateVolunteerProfile}, which cannot reach `isAdult`.
 *
 * `isAdult: false` writes `blocked`, and that mapping lives here rather than in
 * the remote so a hand-crafted POST cannot skip it.
 *
 * Pronouns and phone are written back to `user`, not copied onto the profile:
 * both columns already exist, `/member/account` edits them, and a second copy
 * would be stale by the next time anybody looked.
 */
export async function completeVolunteerOnboarding(
	userId: string,
	data: OnboardingInput
): Promise<VolunteerProfile> {
	const { firstName, lastName, pronouns, phone } = normalizeNames(data);

	const existing = await getVolunteerProfile(userId);
	if (existing) throw new VolunteerProfileExistsError();

	const now = new Date();
	const row = {
		id: crypto.randomUUID(),
		userId,
		firstName,
		lastName,
		isAdult: data.isAdult,
		status: data.isAdult ? ('active' as const) : ('blocked' as const),
		availability: null,
		approvedByUserId: null,
		approvedAt: null,
		createdAt: now,
		updatedAt: now
	};

	// batch, not transaction: `db.transaction()` is unavailable on D1 and banned
	// by `custom/no-db-transaction`. The id is supplied rather than defaulted so
	// the row can be returned without a second read — batch has no `.returning()`.
	await db.batch([
		db.insert(volunteerProfile).values(row),
		db.update(user).set({ pronouns, phone, updatedAt: now }).where(eq(user.id, userId))
	]);

	return row;
}

/**
 * Edit the profile afterwards — the fields behind the Profile modal.
 *
 * Deliberately no `isAdult` and no `status`. Accepting either would let a
 * blocked minor unblock themselves by reopening the modal, which is the one
 * thing this table exists to prevent.
 */
export async function updateVolunteerProfile(
	userId: string,
	data: ProfileNameInput
): Promise<VolunteerProfile> {
	const { firstName, lastName, pronouns, phone } = normalizeNames(data);

	const existing = await getVolunteerProfile(userId);
	if (!existing) throw new VolunteerProfileNotFoundError();

	const now = new Date();

	await db.batch([
		db
			.update(volunteerProfile)
			.set({ firstName, lastName, updatedAt: now })
			.where(eq(volunteerProfile.userId, userId)),
		db.update(user).set({ pronouns, phone, updatedAt: now }).where(eq(user.id, userId))
	]);

	return { ...existing, firstName, lastName, updatedAt: now };
}

/**
 * The free-text "when am I around" note, saved alongside the interest set.
 *
 * Separate from `setInterests` in volunteer-interest-service so that service
 * stays about the join table alone; the remote calls both.
 */
export async function setAvailability(userId: string, availability: string | null): Promise<void> {
	const normalized = normalizeAvailability(availability);

	const updated = await db
		.update(volunteerProfile)
		.set({ availability: normalized, updatedAt: new Date() })
		.where(eq(volunteerProfile.userId, userId))
		.returning({ id: volunteerProfile.id });

	if (updated.length === 0) throw new VolunteerProfileNotFoundError();
}

/**
 * Staff unblocking an under-18 signup.
 *
 * `isAdult` is left alone: they are still a minor, and the next staffer to look
 * needs to know that. Only the gate moves.
 */
export async function approveMinorVolunteer(
	userId: string,
	staffUserId: string
): Promise<VolunteerProfile> {
	const now = new Date();

	const [approved] = await db
		.update(volunteerProfile)
		.set({
			status: 'active',
			approvedByUserId: staffUserId,
			approvedAt: now,
			updatedAt: now
		})
		.where(and(eq(volunteerProfile.userId, userId), eq(volunteerProfile.status, 'blocked')))
		.returning();

	if (approved) return approved;

	// No row matched, which is two different situations to the staffer reading
	// the result — same split HourLogAlreadyReviewedError draws for a double-click.
	const existing = await getVolunteerProfile(userId);
	if (!existing) throw new VolunteerProfileNotFoundError();
	throw new VolunteerAlreadyApprovedError();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getVolunteerProfile(userId: string): Promise<VolunteerProfile | null> {
	const [row] = await db
		.select()
		.from(volunteerProfile)
		.where(eq(volunteerProfile.userId, userId))
		.limit(1);

	return row ?? null;
}

/** Where a member is in the onboarding flow. Drives every route gate. */
export type OnboardingStage = 'none' | 'blocked' | 'active';

export function stageOf(profile: VolunteerProfile | null): OnboardingStage {
	if (!profile) return 'none';
	return profile.status === 'blocked' ? 'blocked' : 'active';
}

/**
 * Assert the member may act as a volunteer. Called from the claim and hour-log
 * paths, which are reachable without ever loading the gated routes.
 */
export async function requireActiveVolunteer(userId: string): Promise<VolunteerProfile> {
	const profile = await getVolunteerProfile(userId);
	if (!profile) throw new VolunteerProfileNotFoundError();
	if (profile.status !== 'active') throw new VolunteerProfileBlockedError();
	return profile;
}

export interface VolunteerOnboardingData {
	profile: VolunteerProfile | null;
	account: { name: string; email: string; pronouns: string | null; phone: string | null };
}

/**
 * The profile plus the `user` fields the onboarding form prefills from.
 *
 * Pronouns and phone come from the DB rather than `locals.user`: `requireUser()`
 * returns better-auth's session user, and `getMemberAccount` reads these same
 * columns from the table for the same reason.
 */
export async function getVolunteerOnboarding(userId: string): Promise<VolunteerOnboardingData> {
	const [row] = await db
		.select({
			name: user.name,
			email: user.email,
			pronouns: user.pronouns,
			phone: user.phone,
			profile: volunteerProfile
		})
		.from(user)
		.leftJoin(volunteerProfile, eq(volunteerProfile.userId, user.id))
		.where(eq(user.id, userId))
		.limit(1);

	if (!row) throw new VolunteerProfileNotFoundError();

	return {
		profile: row.profile ?? null,
		account: { name: row.name, email: row.email, pronouns: row.pronouns, phone: row.phone }
	};
}

export interface BlockedVolunteer {
	userId: string;
	firstName: string;
	lastName: string;
	createdAt: Date;
	member: MemberRef;
}

/**
 * The staff review queue: under-18 signups waiting on a person.
 *
 * Projects the same member ref the hour-log queue does, so the two queues draw
 * the person identically.
 */
export async function listBlockedVolunteers(): Promise<BlockedVolunteer[]> {
	const rows = await db
		.select({
			userId: volunteerProfile.userId,
			firstName: volunteerProfile.firstName,
			lastName: volunteerProfile.lastName,
			createdAt: volunteerProfile.createdAt,
			// Correlated subqueries built per call, not at module scope, so
			// importing this module does no work.
			member: memberRefColumns()
		})
		.from(volunteerProfile)
		.innerJoin(user, eq(user.id, volunteerProfile.userId))
		.where(eq(volunteerProfile.status, 'blocked'))
		.orderBy(asc(volunteerProfile.createdAt));

	return rows.map((row) => ({ ...row, member: toMemberRef(row.member) }));
}

// ---------------------------------------------------------------------------
// The volunteers index
// ---------------------------------------------------------------------------

export interface VolunteerListRow {
	userId: string;
	member: MemberRef;
	status: VolunteerProfileStatus;
	isAdult: boolean;
	/** Every role they ticked, name-sorted — not just the one filtered on. */
	roleNames: string[];
	/** Approved minutes, lifetime. What they actually did, next to what they said. */
	minutes: number;
	/**
	 * "Weekday evenings, some weekends" — what they told us about when they can help.
	 *
	 * The whole reason the interest table exists is to know who to contact when a role
	 * needs filling, and this is the half of that answer the app was collecting and never
	 * showing anybody. See docs/reports/volunteer-workflow-findings.md#a6.
	 */
	availability: string | null;
	/**
	 * `user.phone`, not `directoryContact.phone` — the latter is opt-in *display* data with
	 * its own visibility toggle, and reading it here would conflate "publish this" with
	 * "reach me". Null for most members; a coordinator filling Saturday wants the ones who
	 * gave one.
	 */
	phone: string | null;
	/** When they onboarded, which is the one date every row here has. */
	since: Date;
}

/**
 * The staff volunteers index: everyone who has signed up to volunteer, with
 * what they put their hand up for and what they have actually worked.
 *
 * Keyed on the profile rather than on interest rows, unlike its sibling
 * `listInterestedMembers`. The interests step is skippable and a blocked minor
 * never reaches it, so an interest-keyed list silently drops the two groups
 * staff most need to see — the person who onboarded and picked nothing, and the
 * minor waiting on approval.
 */
export async function listVolunteers(
	filters: { roleId?: string; search?: string; status?: VolunteerProfileStatus } = {},
	pagination: PaginationInput = {}
): Promise<PaginatedResult<VolunteerListRow>> {
	// An EXISTS rather than a WHERE on the joined rows, for the reason
	// `listInterestedMembers` documents: narrowing which *members* appear must
	// still leave each of them showing every role they picked.
	const matchesRole = filters.roleId
		? sql`exists (
				select 1 from "volunteer_role_interest" vri
				where vri."user_id" = ${user.id}
					and vri."volunteer_role_id" = ${filters.roleId}
			)`
		: undefined;

	const matchesSearch = filters.search
		? or(like(user.name, `%${filters.search}%`), like(user.email, `%${filters.search}%`))
		: undefined;

	const matchesStatus = filters.status ? eq(volunteerProfile.status, filters.status) : undefined;

	// A closed account keeps its profile via the FK, but nobody should be rostered
	// after closing their account — the same call `listInterestedMembers` makes.
	const where = and(isNull(user.deletedAt), matchesRole, matchesSearch, matchesStatus);

	// A correlated subquery, deliberately not a join. Joining the hour log
	// alongside the interest join is a cartesian product, and the group_concat
	// below would then repeat every role name once per log — six badges reading
	// "Door, Door, Door" for somebody who worked three shifts.
	const minutes = sql<number>`(
			select coalesce(sum(vhl."minutes"), 0) from "volunteer_hour_log" vhl
			where vhl."user_id" = ${user.id} and vhl."status" = 'approved'
		)`;

	const dataQuery = db
		.select({
			userId: user.id,
			// Built per call, not at module scope — the import-cycle crash the other
			// two services in this folder both document.
			member: memberRefColumns(),
			status: volunteerProfile.status,
			isAdult: volunteerProfile.isAdult,
			availability: volunteerProfile.availability,
			phone: user.phone,
			since: volunteerProfile.createdAt,
			// Left-joined, so a volunteer who ticked nothing still gets a row and this
			// comes back null.
			roleNames: sql<string | null>`group_concat(${volunteerRole.name}, ${ROLE_NAME_SEPARATOR})`,
			minutes
		})
		.from(volunteerProfile)
		.innerJoin(user, eq(user.id, volunteerProfile.userId))
		.leftJoin(volunteerRoleInterest, eq(volunteerRoleInterest.userId, volunteerProfile.userId))
		.leftJoin(volunteerRole, eq(volunteerRole.id, volunteerRoleInterest.volunteerRoleId))
		.where(where)
		.groupBy(user.id)
		.orderBy(asc(user.name))
		.$dynamic();

	// No interest join here — the data query's would multiply the rows being
	// counted and inflate `totalPages`, the trap `getHoursByMember` documents.
	// One profile per member, so a plain count is the member count.
	const countQuery = db
		.select({ count: count() })
		.from(volunteerProfile)
		.innerJoin(user, eq(user.id, volunteerProfile.userId))
		.where(where);

	const result = await paginate(dataQuery, countQuery, pagination);

	return {
		...result,
		rows: result.rows.map((r): VolunteerListRow => ({
			userId: r.userId,
			member: toMemberRef(r.member),
			status: r.status,
			isAdult: r.isAdult,
			roleNames: r.roleNames ? String(r.roleNames).split(ROLE_NAME_SEPARATOR).sort() : [],
			minutes: Number(r.minutes),
			availability: r.availability,
			phone: r.phone,
			since: r.since
		}))
	};
}
