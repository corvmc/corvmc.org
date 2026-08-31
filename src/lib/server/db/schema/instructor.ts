import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user, type DirectoryContact } from './authentication';
import {
	instructorStatuses,
	INSTRUCTOR_HEADLINE_MAX,
	INSTRUCTOR_BLURB_MAX,
	INSTRUCTOR_RATES_NOTE_MAX,
	INSTRUCTOR_APPLICATION_NOTE_MAX,
	INSTRUCTOR_REVIEW_NOTES_MAX
} from '../../../config';

/**
 * A person CMC has granted the right to rent the practice room on teaching
 * terms. See `docs/specs/instructors-spec.md`.
 *
 * **CMC's relationship is with the teacher, not the student.** CMC rents
 * teachers the space; the teacher bills their own students. That is why there is
 * no lesson table, no enrolment, no student row and no payout anywhere in this
 * module — and why one table is the whole schema.
 *
 * It hangs off `user` rather than `directory_entry` for three reasons. It is an
 * *authorization* record consulted before every teaching booking, and
 * `directory_entry` is member-owned — `updateMemberProfile()` does a blind
 * `.set({...})` over eleven columns, so a staff grant there is one added field
 * away from being self-service. `directory_entry` is also optional and
 * polymorphic (user / group / nothing), so an `entryId` FK would let a *band* be
 * granted teaching status — a rule the service layer would have to remember,
 * where `userId NOT NULL UNIQUE REFERENCES user` simply cannot express it. And
 * `volunteer_profile` already established this exact shape for a staff-managed
 * person record, down to the guard signature.
 */
export const instructor = sqliteTable(
	'instructor',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// One per member. The unique constraint is what actually enforces it —
		// the service checks first, but two tabs racing would otherwise both
		// write. Same reasoning as `volunteer_profile.userId`.
		userId: text('user_id')
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: 'cascade' }),

		status: text('status', { enum: instructorStatuses }).notNull().default('requested'),

		// -------------------------------------------------------------------
		// The listing — and, before approval, the application itself.
		// -------------------------------------------------------------------
		// There is no separate application body because these fields *are* what
		// staff are deciding about. One form, and staff approve exactly what
		// they would be publishing.

		headline: text('headline'),
		blurb: text('blurb'),

		/**
		 * Free text ("$40 / half hour"), never cents. CMC does not process lesson
		 * money, and a number it could total would imply otherwise.
		 */
		ratesNote: text('rates_note'),

		/**
		 * Where a student actually books them — a personal site, a scheduling
		 * link. Its own column rather than folded into `teachingContact.social`
		 * because it is the card's call to action and renders as a button, not a
		 * fact in a list.
		 */
		bookingUrl: text('booking_url'),

		/**
		 * The published teaching contact, in the shape `directory_entry.contact`
		 * already uses so it can run through the same `contactForView()` gate. A
		 * second contact shape would mean a second gate, and the second gate is
		 * the one that leaks.
		 *
		 * **Null means fall back to `directory_entry.contact`** — the
		 * `group_member.alias` pattern, so an instructor happy to be reached the
		 * usual way carries no duplicate that goes stale. The fallback is still
		 * gated: a member whose directory contact is `visibility: 'members'`
		 * renders no contact on the public card rather than having their choice
		 * overridden by this module.
		 *
		 * Named `teachingContact`, not `contact`, on purpose. groups-spec phase
		 * 10 adds a `contact` *table* holding private third-party booking
		 * details behind its own ESLint rule — the opposite privacy posture from
		 * this column, which is published by definition.
		 */
		teachingContact: text('teaching_contact', { mode: 'json' }).$type<DirectoryContact>(),

		/**
		 * The instructor's own switch, governing the listing only. "My book is
		 * full this term" and "CMC has suspended my terms" are opposite facts
		 * that one column would conflate — and the first must be settable
		 * without a staff round trip, while the second must never be.
		 */
		acceptingStudents: integer('accepting_students', { mode: 'boolean' }).notNull().default(true),

		// -------------------------------------------------------------------
		// The application's private half — two notes pointing opposite ways.
		// -------------------------------------------------------------------

		/**
		 * Member-written, staff-only: experience, references, whether they have
		 * taught before. **Never rendered publicly and never in a DTO** — the
		 * directory service whitelists its fields explicitly so a newly added
		 * column cannot leak by default.
		 */
		applicationNote: text('application_note'),

		/**
		 * Staff-written, member-visible: why an application came back. Stored
		 * rather than only emailed because `rejected` exists so the member can
		 * fix and resubmit, and they cannot fix what they cannot see. The third
		 * instance of this convention after `event.reviewNotes` and
		 * `volunteer_hour_log.reviewNotes`.
		 */
		reviewNotes: text('review_notes'),

		// -------------------------------------------------------------------
		// The grant, as an audit record.
		// -------------------------------------------------------------------

		/**
		 * Nullable, unlike `volunteer_profile.approvedBy*` — the row exists
		 * before the grant does, because a member's application *is* the row.
		 * `createdAt` is therefore the application timestamp and `grantedAt` is
		 * the approval.
		 *
		 * `set null` matches `volunteerProfile.approvedByUserId`: a departed
		 * staffer must not take the record of the approval with them.
		 */
		grantedByUserId: text('granted_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		grantedAt: integer('granted_at', { mode: 'timestamp' }),

		statusChangedAt: integer('status_changed_at', { mode: 'timestamp' }),

		/** Staff-only. Required on send-back, pause and retire — the next staffer reading the list needs to know why. */
		statusNote: text('status_note'),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		// notNull with a default, unlike `group_member.updatedAt`. That column is
		// nullable only because it was added by ALTER to a table with rows, where
		// SQLite rejects a non-constant default; this is a fresh CREATE TABLE and
		// carries no such constraint.
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	// The staff review queue: applications first, oldest first. Same shape and
	// same reason as `volunteer_profile_status_idx`.
	(t) => [index('instructor_status_idx').on(t.status, t.createdAt)]
);

export type Instructor = typeof instructor.$inferSelect;

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

/**
 * The listing fields a member controls, which are also the application. Staff
 * never write these — they approve or return them.
 */
export const instructorListingSchema = z.object({
	headline: z.string().trim().max(INSTRUCTOR_HEADLINE_MAX).optional(),
	blurb: z.string().trim().max(INSTRUCTOR_BLURB_MAX).optional(),
	ratesNote: z.string().trim().max(INSTRUCTOR_RATES_NOTE_MAX).optional(),
	bookingUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
	applicationNote: z.string().trim().max(INSTRUCTOR_APPLICATION_NOTE_MAX).optional()
});

/** What staff write when handing an application back. */
export const instructorReviewSchema = z.object({
	reviewNotes: z.string().trim().min(1).max(INSTRUCTOR_REVIEW_NOTES_MAX)
});
