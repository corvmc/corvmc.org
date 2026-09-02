import {
	sqliteTable,
	text,
	integer,
	index,
	check,
	unique,
	primaryKey
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { user } from './authentication';
import { event } from './event';
import {
	volunteerHourStatuses,
	volunteerProfileStatuses,
	volunteerRoleGroups,
	volunteerSignupStatuses,
	CERT_DESCRIPTION_MAX,
	CERT_NAME_MAX,
	CERT_NOTES_MAX,
	CERT_REFERENCE_MAX,
	CERT_REVOKED_REASON_MAX,
	SHIFT_FEEDBACK_COMMENT_MAX,
	SHIFT_FEEDBACK_MAX_RATING,
	SHIFT_FEEDBACK_MIN_RATING,
	VOLUNTEER_DESCRIPTION_MAX,
	VOLUNTEER_AVAILABILITY_MAX,
	VOLUNTEER_MAX_INTERESTS,
	VOLUNTEER_MAX_MINUTES_PER_LOG,
	VOLUNTEER_NAME_MAX,
	VOLUNTEER_REVIEW_NOTES_MAX,
	VOLUNTEER_ROLE_DESCRIPTION_MAX,
	VOLUNTEER_ROLE_NAME_MAX,
	VOLUNTEER_SHIFT_MAX_CAPACITY,
	VOLUNTEER_SHIFT_NOTES_MAX
} from '../../../config';

// ---------------------------------------------------------------------------
// Volunteering domain types
// ---------------------------------------------------------------------------

export type VolunteerHourStatus = (typeof volunteerHourStatuses)[number];

export function isVolunteerHourStatus(value: string): value is VolunteerHourStatus {
	return volunteerHourStatuses.includes(value as VolunteerHourStatus);
}

export type VolunteerRoleGroup = (typeof volunteerRoleGroups)[number];

export type VolunteerProfileStatus = (typeof volunteerProfileStatuses)[number];

export function isVolunteerProfileStatus(value: string): value is VolunteerProfileStatus {
	return volunteerProfileStatuses.includes(value as VolunteerProfileStatus);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const createVolunteerRoleSchema = z.object({
	name: z.string().trim().min(1).max(VOLUNTEER_ROLE_NAME_MAX),
	description: z.string().trim().max(VOLUNTEER_ROLE_DESCRIPTION_MAX).optional(),
	group: z.enum(volunteerRoleGroups).default('at-shows'),
	displayOrder: z.coerce.number().int().min(0).default(0),
	isActive: z.coerce.boolean().default(true)
});

export const updateVolunteerRoleSchema = createVolunteerRoleSchema.partial();

export const setVolunteerInterestsSchema = z.object({
	// Unchecking everything is a legitimate submission — it means "take me off
	// the list" — so this bottoms out at an empty array rather than min(1).
	roleIds: z.array(z.uuid()).max(VOLUNTEER_MAX_INTERESTS).default([])
});

/**
 * The onboarding answer set. `isAdult` is a two-value enum rather than a boolean
 * because it arrives from a required select: a checkbox submits nothing when
 * unticked, which makes "I am under 18" and "I skipped the question"
 * indistinguishable — and either default is wrong for somebody.
 */
export const startVolunteerOnboardingSchema = z.object({
	firstName: z.string().trim().min(1).max(VOLUNTEER_NAME_MAX),
	lastName: z.string().trim().min(1).max(VOLUNTEER_NAME_MAX),
	isAdult: z.enum(['yes', 'no']),
	pronouns: z.string().trim().max(50).optional(),
	phone: z.string().trim().max(30).optional()
});

/**
 * The same fields the member may change afterwards — deliberately without
 * `isAdult` or `status`. Letting the age answer be re-submitted would let a
 * blocked minor unblock themselves by reopening the profile modal.
 */
export const updateVolunteerProfileSchema = startVolunteerOnboardingSchema.omit({ isAdult: true });

export const setVolunteerAvailabilitySchema = z.object({
	availability: z.string().trim().max(VOLUNTEER_AVAILABILITY_MAX).optional()
});

export const submitHoursSchema = z.object({
	volunteerRoleId: z.uuid(),
	// YYYY-MM-DD in club time; the service anchors it at noon.
	workedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	minutes: z.coerce.number().int().min(1).max(VOLUNTEER_MAX_MINUTES_PER_LOG),
	description: z.string().trim().min(1).max(VOLUNTEER_DESCRIPTION_MAX)
});

export const reviewHoursSchema = z.object({
	id: z.uuid(),
	notes: z.string().trim().max(VOLUNTEER_REVIEW_NOTES_MAX).optional()
});

export const createCertificationSchema = z.object({
	name: z.string().trim().min(1).max(CERT_NAME_MAX),
	description: z.string().trim().max(CERT_DESCRIPTION_MAX).optional(),
	/** Null/blank means internal to CMC — we grant it ourselves. */
	issuedBy: z.string().trim().max(CERT_NAME_MAX).optional(),
	/** Null means it never lapses, which is the normal case for internal clearances. */
	validityMonths: z.coerce.number().int().min(1).max(600).optional(),
	displayOrder: z.coerce.number().int().min(0).default(0),
	isActive: z.coerce.boolean().default(true)
});

export const updateCertificationSchema = createCertificationSchema.partial();

export const grantCertificationSchema = z.object({
	userId: z.uuid(),
	certificationId: z.uuid(),
	// YYYY-MM-DD in club time; the service anchors it at noon.
	grantedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	reference: z.string().trim().max(CERT_REFERENCE_MAX).optional(),
	notes: z.string().trim().max(CERT_NOTES_MAX).optional()
});

export const revokeCertificationSchema = z.object({
	id: z.uuid(),
	// Required, for the same reason a rejected hour log needs one: the next
	// staffer looking at the list needs to know why this person is off it.
	reason: z.string().trim().min(1).max(CERT_REVOKED_REASON_MAX)
});

export const createShiftSchema = z.object({
	volunteerRoleId: z.uuid(),
	eventId: z.uuid().optional(),
	// Wall-clock in club time, `YYYY-MM-DDTHH:mm` from a datetime-local input.
	startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
	endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
	capacity: z.coerce.number().int().min(1).max(VOLUNTEER_SHIFT_MAX_CAPACITY),
	notes: z.string().trim().max(VOLUNTEER_SHIFT_NOTES_MAX).optional()
});

export const updateShiftSchema = createShiftSchema.partial().extend({ id: z.uuid() });

export const submitShiftFeedbackSchema = z.object({
	signupId: z.uuid(),
	rating: z.coerce.number().int().min(SHIFT_FEEDBACK_MIN_RATING).max(SHIFT_FEEDBACK_MAX_RATING),
	wasSetUp: z.coerce.boolean(),
	comment: z.string().trim().max(SHIFT_FEEDBACK_COMMENT_MAX).optional()
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * A volunteer role is a *job description*, not a permission. The auth roles
 * (`role` in ./authorization) are a different thing entirely — a row here grants
 * nothing. Staff-managed so the taxonomy can change without a migration, and a
 * table rather than a config list so each role can carry the markdown job
 * description the member-facing page is built around.
 */
export const volunteerRole = sqliteTable('volunteer_role', {
	id: text()
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull().unique(),
	description: text('description'),

	// Presentational only — how the role is bucketed when roles are listed for
	// someone to choose from. Nothing branches on it; a role in the wrong group
	// is a cosmetic bug, not a broken workflow. Defaulted so the ADD COLUMN
	// needs no backfill.
	group: text('group', { enum: volunteerRoleGroups }).notNull().default('at-shows'),

	displayOrder: integer('display_order').notNull().default(0),

	// Prefills for the shift form only — the shift carries the real times and
	// headcount once created, so editing these never reaches back into shifts
	// already scheduled.
	defaultDurationMinutes: integer('default_duration_minutes'),
	defaultCapacity: integer('default_capacity'),

	// Retirement is an archive, not a delete: hour logs reference the role and
	// reports must keep resolving it. Archived roles disappear from the member
	// submit form and nowhere else.
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),

	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

/**
 * A dated, time-bounded need for a role — "two Front Desk, Saturday 6–10pm".
 *
 * Where an interest says someone *would* do a job, a shift is the job on a
 * particular evening. Staff create them; members claim them. There is no
 * recurrence: a standing weekly slot is made by duplicating last week's, which
 * keeps the table free of series bookkeeping until something actually needs it.
 */
export const volunteerShift = sqliteTable(
	'volunteer_shift',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// Restrict, like the hour log's: a worked shift is history, and deleting
		// the role out from under it would rewrite the past.
		volunteerRoleId: text('volunteer_role_id')
			.notNull()
			.references(() => volunteerRole.id, { onDelete: 'restrict' }),

		// Optional. Most shifts hang off a show, but work parties and gear repair
		// days don't, so this can't be required. Set-null rather than cascade —
		// deleting an event must not silently delete the record that four people
		// worked it.
		eventId: text('event_id').references(() => event.id, { onDelete: 'set null' }),

		startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
		endsAt: integer('ends_at', { mode: 'timestamp' }).notNull(),

		/** How many people are needed. Claims beyond this are refused. */
		capacity: integer('capacity').notNull().default(1),

		/** "Meet at the side door" — anything the claimant needs to know. */
		notes: text('notes'),

		// Cancelling keeps the row so claimants stay notifiable and the history of
		// what was called off survives.
		cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),

		// Who called it off. The cancelled shift names them ("Called off Sep 1 by
		// Nia Okafor") because the roster it leaves behind is a list of people
		// somebody now has to ring, and "somebody" needs a name.
		cancelledByUserId: text('cancelled_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// The member's "what's coming up" list and the reminder cron both scan
		// forward from now over live shifts.
		index('volunteer_shift_upcoming_idx')
			.on(t.startsAt)
			.where(sql`cancelled_at IS NULL`),
		index('volunteer_shift_role_idx').on(t.volunteerRoleId),
		index('volunteer_shift_event_idx').on(t.eventId),
		check('volunteer_shift_ends_after_start', sql`ends_at > starts_at`),
		check('volunteer_shift_capacity_positive', sql`capacity > 0`)
	]
);

/**
 * One member on one shift.
 *
 * The statuses are `reservationStatuses` minus the ones that don't apply, on
 * purpose — a claim and a room booking move through the same lifecycle, and
 * inventing a second vocabulary for it would be a tax on every reader.
 */
export const volunteerSignup = sqliteTable(
	'volunteer_signup',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		shiftId: text('shift_id')
			.notNull()
			.references(() => volunteerShift.id, { onDelete: 'cascade' }),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		status: text('status', { enum: volunteerSignupStatuses }).notNull().default('claimed'),

		claimedAt: integer('claimed_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		confirmedAt: integer('confirmed_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' }),
		cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),

		// Only meaningful once the *shift* is cancelled: the roster becomes the
		// list of people to tell, and this is how far down it staff have got.
		// Separate from the notification the cancel itself sends, because staff
		// ring the ones who need ringing and mark those by hand.
		notifiedAt: integer('notified_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// The backstop for a double-clicked claim: the service guards on capacity
		// first, but two requests can pass that check at once.
		unique('uq_volunteer_signup').on(t.shiftId, t.userId),
		index('volunteer_signup_shift_idx').on(t.shiftId, t.status),
		index('volunteer_signup_user_idx').on(t.userId, t.status)
	]
);

export const volunteerHourLog = sqliteTable(
	'volunteer_hour_log',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// The member is the subject of the row, so a hard account purge takes it —
		// same call as equipmentLoan.userId.
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		// Restrict, because every report groups by this. Staff archive a role they
		// no longer use; deleting one with history would silently rewrite the past.
		volunteerRoleId: text('volunteer_role_id')
			.notNull()
			.references(() => volunteerRole.id, { onDelete: 'restrict' }),

		// The shift this log was filed against, if it was scheduled rather than
		// logged from memory. Staff can approve one of these with less scrutiny —
		// they already knew the person was rostered. Set-null, not cascade:
		// deleting a shift must not delete the hours somebody actually worked.
		shiftId: text('shift_id').references(() => volunteerShift.id, { onDelete: 'set null' }),

		// A calendar date, but this schema has no text-date columns, so it's a
		// timestamp anchored at NOON club time.
		//
		// The report buckets months with strftime('%Y-%m', ..., 'unixepoch'),
		// which reads the instant in UTC. Noon local lands mid-day in UTC for any
		// offset from -11 to +11, so the UTC month always matches the local date.
		// Midnight local happens to work for the Americas (00:00 PT = 07:00 UTC,
		// same day) but breaks for UTC-ahead zones, where it is the previous UTC
		// day — every 1st-of-the-month log would bucket into the prior month.
		// Noon costs nothing and removes the class of bug entirely.
		workedOn: integer('worked_on', { mode: 'timestamp' }).notNull(),

		// Integer minutes, never floats. The UI takes quarter-hours and renders
		// via formatVolunteerHours().
		minutes: integer('minutes').notNull(),
		description: text('description').notNull(),

		status: text('status', { enum: volunteerHourStatuses }).notNull().default('pending'),

		// set-null keeps the review through staff account deletion, matching
		// contentFlag.resolvedByUserId.
		reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
		reviewNotes: text('review_notes'),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('volunteer_hour_log_user_idx').on(t.userId),
		// The pending queue, which is the page staff live on.
		index('volunteer_hour_log_status_idx').on(t.status, t.workedOn),
		index('volunteer_hour_log_worked_on_idx').on(t.workedOn),
		// The by-role rollup and the delete guard.
		index('volunteer_hour_log_role_idx').on(t.volunteerRoleId),
		// Backstop only — the service enforces the tighter VOLUNTEER_MAX_MINUTES_PER_LOG.
		check('volunteer_minutes_positive', sql`minutes > 0 AND minutes <= 1440`)
	]
);

/**
 * A standing "I'd do this" — the member has told staff to think of them when
 * this role needs filling. It is not a commitment to any particular date; that
 * is what a Phase 2 shift claim would be. Expressing interest grants nothing
 * and obliges nothing, which is why the row carries no status: it exists or it
 * doesn't, and the member flips it themselves.
 */
export const volunteerRoleInterest = sqliteTable(
	'volunteer_role_interest',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// The member is the subject of the row — same call as volunteerHourLog.userId.
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		// Cascade, unlike the hour log's restrict. An hour log is history and must
		// keep resolving its role; an interest is a current preference with nothing
		// to preserve, and blocking a role delete over one would be surprising.
		volunteerRoleId: text('volunteer_role_id')
			.notNull()
			.references(() => volunteerRole.id, { onDelete: 'cascade' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Re-saving the same set must not stack duplicate rows.
		unique('uq_volunteer_role_interest').on(t.userId, t.volunteerRoleId),
		// "Who is interested in Door?" — the staff page's only query.
		index('volunteer_role_interest_role_idx').on(t.volunteerRoleId),
		index('volunteer_role_interest_user_idx').on(t.userId)
	]
);

/**
 * What we know about a person as a *volunteer*, as distinct from as a member.
 *
 * Exists for one reason the member row cannot cover: whether they are 18 or
 * older. The collective owes minors a different process, so the answer has to be
 * on file before anyone claims a shift, and it has to be asked once rather than
 * inferred.
 *
 * `firstName`/`lastName` are here and not on `user`, which has a single `name`
 * the member chose and the directory renders. A sign-in sheet and a waiver want
 * the parts separately, and rewriting `name` to get them would change how they
 * appear to everyone else.
 *
 * Pronouns and phone are deliberately *not* duplicated here — they already exist
 * on `user`, `/member/account` edits them, and a second copy would diverge
 * within a week. Onboarding writes back to those columns.
 */
export const volunteerProfile = sqliteTable(
	'volunteer_profile',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// One per member. The unique constraint is what actually enforces that —
		// the service checks first, but two tabs racing would otherwise both write.
		userId: text('user_id')
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: 'cascade' }),

		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),

		// Kept after a staff override, so an approved minor still reads as a minor.
		// Folding this into `status` would erase it at the moment it starts mattering.
		isAdult: integer('is_adult', { mode: 'boolean' }).notNull(),

		status: text('status', { enum: volunteerProfileStatuses }).notNull().default('active'),

		// One note per member rather than per interest: "weekday evenings" is true
		// of the person, not of the Door role.
		availability: text('availability'),

		// set-null, matching volunteerHourLog.reviewedByUserId — a departed staffer
		// must not take the record of the approval with them.
		approvedByUserId: text('approved_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		approvedAt: integer('approved_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	// The staff review queue: blocked profiles, oldest first.
	(t) => [index('volunteer_profile_status_idx').on(t.status, t.createdAt)]
);

/**
 * How a shift went, from the person who worked it.
 *
 * Keyed to the signup, so the unit is one person on one shift — the question
 * "how was Door on the 7th" only means something for the people who were
 * actually rostered on it.
 */
export const volunteerShiftFeedback = sqliteTable(
	'volunteer_shift_feedback',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// Unique: one response per signup. Cascade, because feedback on a deleted
		// signup has nothing left to be about.
		signupId: text('signup_id')
			.notNull()
			.unique()
			.references(() => volunteerSignup.id, { onDelete: 'cascade' }),

		/** 1–5. */
		rating: integer('rating').notNull(),

		/**
		 * "Were you set up to succeed?" — deliberately separate from the rating.
		 * A volunteer can enjoy a shift that was badly briefed, and the two
		 * answers pull apart in exactly the cases worth acting on.
		 */
		wasSetUp: integer('was_set_up', { mode: 'boolean' }).notNull(),

		comment: text('comment'),

		submittedAt: integer('submitted_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Literals, not interpolated constants: drizzle binds an interpolated value
		// as a parameter, and SQLite rejects parameters in a CHECK constraint
		// outright. Backstop only — the service enforces SHIFT_FEEDBACK_MIN_RATING
		// and SHIFT_FEEDBACK_MAX_RATING, same arrangement as the hour log's
		// minutes check above.
		check('volunteer_shift_feedback_rating_range', sql`rating >= 1 AND rating <= 5`),
		index('volunteer_shift_feedback_submitted_idx').on(t.submittedAt)
	]
);

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

/**
 * The catalog of clearances, staff-managed like roles.
 *
 * A certification is a thing, not a property of a role: First Aid is not a
 * volunteer role and never will be, and one clearance often covers several roles
 * — sound desk clearance applies to Sound Engineering and to Load-Out. So roles
 * *reference* certifications rather than each carrying a `requiresTraining` flag,
 * which would have nowhere to put First Aid and would record one training twice.
 */
export const volunteerCertification = sqliteTable('volunteer_certification', {
	id: text()
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),

	name: text('name').notNull().unique(),
	description: text('description'),

	/** Null = internal to CMC. "Oregon Health Authority" etc. for external cards. */
	issuedBy: text('issued_by'),

	/** Null = never lapses, which is the normal case for internal clearances. */
	validityMonths: integer('validity_months'),

	displayOrder: integer('display_order').notNull().default(0),
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),

	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

/**
 * One member holding one certification, once. **Renewals append a new row.**
 *
 * There is deliberately no unique constraint on (userId, certificationId): that
 * absence is the append-only decision made structural. Overwriting a grant date
 * on renewal would destroy the answer to the question that actually gets asked
 * after an incident — *was their First Aid current on the day they worked that
 * shift?* "Do they hold X now" is the most recent row by `grantedAt`.
 *
 * No status column either. current / expiring soon / expired / revoked is
 * derived from these dates against today in club time; a stored status would be
 * wrong the moment the clock passed midnight.
 */
export const memberCertification = sqliteTable(
	'member_certification',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		// Restrict — a held certification is history, so the catalog entry it
		// points at has to keep resolving. Archive the catalog entry instead.
		certificationId: text('certification_id')
			.notNull()
			.references(() => volunteerCertification.id, { onDelete: 'restrict' }),

		/** Calendar date, anchored at noon club time. */
		grantedAt: integer('granted_at', { mode: 'timestamp' }).notNull(),

		/**
		 * Stamped from the catalog's `validityMonths` at grant time, never computed
		 * on read: shortening "Food Handler: 3 years" to 2 must not retroactively
		 * expire cards that were validly issued for three. Null = never expires.
		 */
		expiresAt: integer('expires_at', { mode: 'timestamp' }),

		grantedByUserId: text('granted_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		/** External card or licence number. */
		reference: text('reference'),
		notes: text('notes'),

		// Pulled early. The window it covered is still history, which is why this
		// is a timestamp rather than a delete.
		revokedAt: integer('revoked_at', { mode: 'timestamp' }),
		revokedReason: text('revoked_reason'),
		revokedByUserId: text('revoked_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// "What does this member hold" — the member block and the grant card.
		index('member_certification_user_idx').on(t.userId, t.certificationId),
		// The clearances view: who is current, expiring, lapsed.
		index('member_certification_expiry_idx')
			.on(t.expiresAt)
			.where(sql`revoked_at IS NULL`),
		// A reason is not optional when something was pulled — the next staffer
		// reading the list needs to know why this person is no longer on it.
		check(
			'member_certification_revoked_has_reason',
			sql`(revoked_at IS NULL) = (revoked_reason IS NULL)`
		)
	]
);

/** Which clearances a role requires. A link, so both sides cascade. */
export const volunteerRoleCertification = sqliteTable(
	'volunteer_role_certification',
	{
		volunteerRoleId: text('volunteer_role_id')
			.notNull()
			.references(() => volunteerRole.id, { onDelete: 'cascade' }),
		certificationId: text('certification_id')
			.notNull()
			.references(() => volunteerCertification.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.volunteerRoleId, t.certificationId] }),
		index('volunteer_role_certification_cert_idx').on(t.certificationId)
	]
);

export type VolunteerRole = typeof volunteerRole.$inferSelect;
export type VolunteerHourLog = typeof volunteerHourLog.$inferSelect;
export type VolunteerRoleInterest = typeof volunteerRoleInterest.$inferSelect;
export type VolunteerProfile = typeof volunteerProfile.$inferSelect;
export type VolunteerShift = typeof volunteerShift.$inferSelect;
export type VolunteerSignup = typeof volunteerSignup.$inferSelect;
export type VolunteerShiftFeedback = typeof volunteerShiftFeedback.$inferSelect;
export type VolunteerCertification = typeof volunteerCertification.$inferSelect;
export type MemberCertification = typeof memberCertification.$inferSelect;
