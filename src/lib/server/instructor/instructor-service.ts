import { and, eq, inArray } from 'drizzle-orm';
import { db, getRowCount } from '$lib/server/db';
import { instructor, type Instructor } from '$lib/server/db/schema/instructor';
import { DomainError } from '$lib/server/domain-error';
import type { InstructorStatus } from '$lib/config';

/**
 * Instructors — people CMC has granted the right to rent the practice room on
 * teaching terms. See `docs/specs/instructors-spec.md`.
 *
 * Two things this module is not, both load-bearing:
 *
 * - **It is not a lessons module.** CMC's relationship is with the teacher, not
 *   the student, so nothing here records a student, a lesson or a payment
 *   between them.
 * - **It is not a moderation surface.** Handing an application back is a
 *   judgement about a *proposal* and gets a return state; a judgement about the
 *   *person* is a behaviour call and belongs to `member_standing`.
 *
 * Every status filter matches **positively**. `requireInstructor` asks for
 * `active`, and the two application states are refused because they are not it
 * — not because anyone wrote a check for them.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InstructorNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('Instructor not found');
		this.name = 'InstructorNotFoundError';
	}
}

export class InstructorNotActiveError extends DomainError {
	readonly httpStatus = 403;

	constructor(status: InstructorStatus) {
		super(
			status === 'requested' || status === 'rejected'
				? 'Your application to teach at CMC has not been approved yet.'
				: 'Your teaching status is not active.'
		);
		this.name = 'InstructorNotActiveError';
	}
}

export class AlreadyAnInstructorError extends DomainError {
	readonly httpStatus = 409;

	constructor() {
		super('You already have an instructor record.');
		this.name = 'AlreadyAnInstructorError';
	}
}

export class InstructorStateError extends DomainError {
	readonly httpStatus = 422;

	constructor(message: string) {
		super(message);
		this.name = 'InstructorStateError';
	}
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The caller's own record, whatever state it is in. Null when they have none. */
export async function getByUserId(userId: string): Promise<Instructor | null> {
	const [row] = await db.select().from(instructor).where(eq(instructor.userId, userId)).limit(1);
	return row ?? null;
}

export async function getById(id: string): Promise<Instructor | null> {
	const [row] = await db.select().from(instructor).where(eq(instructor.id, id)).limit(1);
	return row ?? null;
}

// ---------------------------------------------------------------------------
// The member's half
// ---------------------------------------------------------------------------

/** The listing fields a member controls — which, before approval, are the application. */
export interface InstructorListingInput {
	headline?: string | null;
	blurb?: string | null;
	ratesNote?: string | null;
	bookingUrl?: string | null;
	applicationNote?: string | null;
}

/** The two states in which the ball is with the member. */
const APPLICATION_STATES = ['requested', 'rejected'] as const satisfies readonly InstructorStatus[];

/**
 * Apply to teach, or resubmit an application that was handed back.
 *
 * There is no separate application record: the listing fields *are* what staff
 * decide about, so applying writes the row a grant would later publish.
 *
 * Resubmitting from `rejected` returns the row to `requested` and **leaves
 * `reviewNotes` in place**. The note is the record of what staff asked for, and
 * clearing it on resubmit would delete the question at the moment the answer
 * arrives — the reviewer would see a fresh application with no memory of why it
 * came back. Staff clear it when they act.
 */
export async function apply(userId: string, listing: InstructorListingInput): Promise<void> {
	const existing = await getByUserId(userId);

	if (existing && !APPLICATION_STATES.includes(existing.status as 'requested' | 'rejected')) {
		throw new AlreadyAnInstructorError();
	}

	const now = new Date();
	if (existing) {
		await db
			.update(instructor)
			.set({ ...listing, status: 'requested', updatedAt: now })
			.where(and(eq(instructor.id, existing.id), inArray(instructor.status, APPLICATION_STATES)));
		return;
	}

	await db.insert(instructor).values({
		userId,
		status: 'requested',
		...listing,
		createdAt: now,
		updatedAt: now
	});
}

/**
 * Edit the listing. Legal while the application is open *and* once active — an
 * instructor keeps their own listing current without a staff round trip.
 *
 * Scoped by `userId` in the WHERE clause rather than checked first: the id comes
 * from the client, and a member's authority stops at their own row.
 */
export async function updateListing(
	userId: string,
	listing: InstructorListingInput
): Promise<void> {
	const result = await db
		.update(instructor)
		.set({ ...listing, updatedAt: new Date() })
		.where(
			and(
				eq(instructor.userId, userId),
				inArray(instructor.status, ['requested', 'rejected', 'active'])
			)
		);

	if (getRowCount(result) === 0) throw new InstructorNotFoundError();
}

/** The instructor's own "my book is full" switch. Active records only. */
export async function setAcceptingStudents(userId: string, accepting: boolean): Promise<void> {
	const result = await db
		.update(instructor)
		.set({ acceptingStudents: accepting, updatedAt: new Date() })
		.where(and(eq(instructor.userId, userId), eq(instructor.status, 'active')));

	if (getRowCount(result) === 0) throw new InstructorNotFoundError();
}

/**
 * Withdraw an open application — a hard delete of the member's own row, exactly
 * as `leaveGroup` deletes a `requested` roster row. There is nothing to keep: an
 * application nobody acted on is not a record of anything.
 */
export async function withdraw(userId: string): Promise<void> {
	const result = await db
		.delete(instructor)
		.where(and(eq(instructor.userId, userId), inArray(instructor.status, APPLICATION_STATES)));

	if (getRowCount(result) === 0) throw new InstructorNotFoundError();
}

// ---------------------------------------------------------------------------
// The staff half
// ---------------------------------------------------------------------------

/**
 * Approve an application.
 *
 * Scoped positively to the two application states, mirroring
 * `approveApplication` in `group-service.ts`. `rejected` is included
 * deliberately: a staffer who handed something back and then changed their mind
 * should not have to ask the member to resubmit first.
 *
 * The scope is what stops this promoting a `retired` row back to `active` — that
 * is `grant()`'s job, and it is a different decision.
 */
export async function approve(id: string, staffUserId: string): Promise<void> {
	const now = new Date();
	const result = await db
		.update(instructor)
		.set({
			status: 'active',
			grantedByUserId: staffUserId,
			grantedAt: now,
			statusChangedAt: now,
			// The application is settled; the note that asked for changes is spent.
			reviewNotes: null,
			updatedAt: now
		})
		.where(and(eq(instructor.id, id), inArray(instructor.status, APPLICATION_STATES)));

	if (getRowCount(result) === 0) throw new InstructorNotFoundError();
}

/**
 * Hand an application back with a reason.
 *
 * **Not a decline, and not an appealable decision.** The member edits and
 * resubmits; `reviewNotes` is stored rather than only emailed because they
 * cannot fix what they cannot see. The third instance of the convention after
 * `event.reviewNotes` and `volunteer_hour_log.reviewNotes`.
 *
 * The row is not deleted, which is where this departs from
 * `declineApplication()`: a group application carries no content, so deleting is
 * the only sensible decline there. An instructor application is a draft listing.
 */
export async function sendBack(
	id: string,
	staffUserId: string,
	reviewNotes: string
): Promise<void> {
	const now = new Date();
	const result = await db
		.update(instructor)
		.set({
			status: 'rejected',
			reviewNotes,
			grantedByUserId: staffUserId,
			statusChangedAt: now,
			updatedAt: now
		})
		.where(and(eq(instructor.id, id), eq(instructor.status, 'requested')));

	if (getRowCount(result) === 0) throw new InstructorNotFoundError();
}

/**
 * Grant teaching status directly, with no application — the staffer already
 * knows this person. Also the way back from `paused` or `retired`, because
 * reinstating and granting are the same decision made twice.
 */
export async function grant(userId: string, staffUserId: string): Promise<void> {
	const now = new Date();
	const existing = await getByUserId(userId);

	if (existing?.status === 'active') throw new AlreadyAnInstructorError();

	if (existing) {
		await db
			.update(instructor)
			.set({
				status: 'active',
				grantedByUserId: staffUserId,
				grantedAt: now,
				statusChangedAt: now,
				reviewNotes: null,
				statusNote: null,
				updatedAt: now
			})
			.where(eq(instructor.id, existing.id));
		return;
	}

	await db.insert(instructor).values({
		userId,
		status: 'active',
		grantedByUserId: staffUserId,
		grantedAt: now,
		statusChangedAt: now,
		createdAt: now,
		updatedAt: now
	});
}

/**
 * Pause or retire a grant. Both block booking; they differ in intent, and the
 * staff list needs to tell "off for the summer" from "no longer teaches here".
 *
 * **Neither cancels future teaching bookings.** Ending a grant is a decision
 * about the future, and a booked lesson has a student on the other end who has
 * already been told a time. Cancelling is a separate, deliberate act.
 */
async function setBlockedStatus(
	id: string,
	staffUserId: string,
	status: 'paused' | 'retired',
	statusNote: string,
	from: readonly InstructorStatus[]
): Promise<void> {
	if (!statusNote.trim()) {
		throw new InstructorStateError('Say why — the next staffer reading this list needs to know.');
	}

	const now = new Date();
	const result = await db
		.update(instructor)
		.set({
			status,
			statusNote,
			grantedByUserId: staffUserId,
			statusChangedAt: now,
			updatedAt: now
		})
		.where(and(eq(instructor.id, id), inArray(instructor.status, from)));

	if (getRowCount(result) === 0) throw new InstructorNotFoundError();
}

export function pause(id: string, staffUserId: string, statusNote: string): Promise<void> {
	return setBlockedStatus(id, staffUserId, 'paused', statusNote, ['active']);
}

export function retire(id: string, staffUserId: string, statusNote: string): Promise<void> {
	return setBlockedStatus(id, staffUserId, 'retired', statusNote, ['active', 'paused']);
}
