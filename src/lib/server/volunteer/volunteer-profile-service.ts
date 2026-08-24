import { db } from '$lib/server/db';
import { volunteerProfile } from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, eq } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import type { MemberRef } from '$lib/types/entity';
import { VOLUNTEER_AVAILABILITY_MAX, VOLUNTEER_NAME_MAX } from '$lib/config';
import type { VolunteerProfile } from '$lib/server/db/schema/volunteer';

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
