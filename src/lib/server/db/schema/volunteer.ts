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
import { inventoryAsset } from './inventory';
import { project } from './project';
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
	VOLUNTEER_SHIFT_NOTES_MAX,
	dutyListAnchors
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

	/**
	 * Whether an hour worked under this role is a **specialized skill**, in the
	 * accounting sense that splits donated time into two numbers that are never
	 * added together.
	 *
	 * Every approved hour counts toward *impact value*, at the Independent
	 * Sector rate in `volunteer.hourValueCents`. Only a specialized skill — one
	 * the collective would otherwise have had to buy — counts as a
	 * *recognizable contributed service* under FASB, and at what that skill
	 * actually costs rather than at the general rate. A donated audio engineer's
	 * hour and a door shift are different accounting objects despite being the
	 * same work-order shape.
	 *
	 * This is the sibling of the test the acquisitions register already applies
	 * to donated *goods*; see `acquisition.fair_value_cents`.
	 *
	 * Constant default, so the ADD COLUMN needs no backfill.
	 */
	isSpecializedSkill: integer('is_specialized_skill', { mode: 'boolean' }).notNull().default(false),

	/**
	 * What this skill would cost to buy, per hour.
	 *
	 * On the role rather than in site config because "what that skill costs" is
	 * not one number — a donated audio engineer and a donated bookkeeper differ
	 * — which is exactly why the impact rate can live in config and this cannot.
	 *
	 * **Null on a specialized role means priced-but-unpriced, and contributes
	 * zero.** It must never fall back to the impact rate: that fallback would
	 * silently merge the two columns, which is the single error this whole
	 * split exists to prevent. Reports surface it as a gap instead.
	 */
	marketRateCents: integer('market_rate_cents'),

	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

/**
 * A **work order**: a triaged, scoped piece of work for a role — "two Front
 * Desk, Saturday 6–10pm", or "re-cone the bass cab, whenever".
 *
 * The CMMS term, adopted deliberately (docs/specs/project-spec.md#vocabulary): a
 * `work_request` is what someone noticed, a work order is what staff have
 * decided to do about it — or work nobody requested at all. Its scheduled
 * state is a **shift**: where an interest says someone *would* do a job, a
 * shift is the job on a particular evening, and member-facing copy keeps that
 * word. Staff create them; members claim them. There is no recurrence: a
 * standing weekly slot is made by duplicating last week's, which keeps the
 * table free of series bookkeeping until something actually needs it.
 *
 * Renamed from `volunteer_shift`. Index and check names keep the old prefix:
 * SQLite carries them through `RENAME TO` for free, and renaming them would
 * turn a one-line ALTER into a table rebuild for no gain.
 */
export const workOrder = sqliteTable(
	'work_order',
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

		// Nullable, because an unscheduled row is a bare work order: work that
		// needs doing with nobody booked to do it yet. Setting a window turns it
		// into an ordinary claimable shift; the two are the same row in two states.
		//
		// Every forward-looking query filters `starts_at >= now` or orders by it,
		// and `NULL >= x` is NULL in SQLite — so unscheduled work falls out of the
		// member list, the reminder cron and the feedback cron on its own, with no
		// query changed. That is load-bearing: assert it rather than trust it.
		startsAt: integer('starts_at', { mode: 'timestamp' }),
		endsAt: integer('ends_at', { mode: 'timestamp' }),

		// What the work is about, when it is about a thing. Null for an ordinary
		// shift — nobody staffs the front desk on behalf of an amp.
		assetId: text('asset_id').references(() => inventoryAsset.id, { onDelete: 'set null' }),

		// The body of work this belongs to, when it belongs to one. A third
		// optional anchor beside `eventId` and `assetId`, not a replacement for
		// either: a work order can be *in* the renovation and *at* Saturday's
		// doors. Set-null, so deleting a project never deletes the record that
		// four people worked it.
		projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),

		/** A deadline, which is not a window: "done by Friday" is not "happens Friday 6-8". */
		dueAt: integer('due_at', { mode: 'timestamp' }),

		// Provenance only: which duty list stamped this row out, so a work order can
		// say "staffed from Standard Show", and so a second apply can be refused
		// rather than silently doubling the roster.
		//
		// Set-null, and never read for cascade or edit propagation. Editing a duty
		// list must not reach into shifts people have already claimed — the copy is
		// an ordinary shift, the same bargain `duplicateShift` makes when it says the
		// copy has "no link back".
		dutyListId: text('duty_list_id').references(() => dutyList.id, { onDelete: 'set null' }),

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

		// Whether the *work* is finished, which is not whether anyone turned up.
		// `completeFinishedShifts()` promotes a signup once the clock runs out —
		// that says the volunteer worked and earns their hours. A session can end
		// with the amp still broken, so closure lives here and nowhere else.
		//
		// A timestamp rather than a status enum, matching `cancelledAt` here and
		// `retiredAt` / `deletedAt` / `revokedAt` across the schema. Open work is
		// `resolved_at IS NULL AND cancelled_at IS NULL`.
		resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
		resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		resolutionNotes: text('resolution_notes'),

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
		index('volunteer_shift_asset_idx').on(t.assetId),
		index('work_order_project_idx').on(t.projectId),
		// The coordinator's queue: work that needs somebody on it.
		index('volunteer_shift_unscheduled_idx')
			.on(t.createdAt)
			.where(sql`starts_at is null and resolved_at is null and cancelled_at is null`),
		// Either both ends are set or neither is — a half-scheduled shift is a bug,
		// not a work order.
		//
		// Compare null-ness rather than writing `(a is null and b is null) or
		// b > a`: that form leaves `starts_at` set and `ends_at` null evaluating to
		// `false OR NULL` = NULL, and SQLite passes a CHECK that returns NULL. Only
		// an explicit false rejects. `(x is null)` always yields 0 or 1, so this
		// cannot leak — same shape as `member_certification_revoked_has_reason`.
		check(
			'volunteer_shift_ends_after_start',
			sql`(starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at)`
		),
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
			.references(() => workOrder.id, { onDelete: 'cascade' }),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		status: text('status', { enum: volunteerSignupStatuses }).notNull().default('claimed'),

		// When this person says they will be there. Null inherits the shift's
		// window, which is the common case: doors are at 7, so the desk is staffed
		// 6-10 regardless of who takes it, and copying that into every signup would
		// store one fact twice.
		//
		// It is a separate fact for task-driven work. A repair has no natural
		// window — the amp does not care — so "Tuesday evening" is a fact about
		// Alice, not about the amp. Neither derives from the other.
		scheduledStartsAt: integer('scheduled_starts_at', { mode: 'timestamp' }),
		scheduledEndsAt: integer('scheduled_ends_at', { mode: 'timestamp' }),

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
		shiftId: text('shift_id').references(() => workOrder.id, { onDelete: 'set null' }),

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

		// When they were actually there, which is the only tier that knows somebody
		// stayed until midnight. `workedOn` is a noon-anchored *date* and `minutes`
		// a bare count, so before these the expected-vs-actual delta had no left
		// hand side.
		//
		// Nullable: hours logged from memory supply `minutes` and nothing else.
		// When both are given `minutes` is computed from them at write time rather
		// than derived on read — every report sums it, and two representations that
		// can disagree eventually do.
		startedAt: integer('started_at', { mode: 'timestamp' }),
		endedAt: integer('ended_at', { mode: 'timestamp' }),

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

// ---------------------------------------------------------------------------
// Work tasks — the checklist inside one work order
// ---------------------------------------------------------------------------

/**
 * An item on a work order's list, ticked by whoever is on it.
 *
 * A volunteer signs up for **Tear Down** and logs one hour entry for it. Nobody
 * signs up for "take the trash out", and nobody logs four minutes against it.
 * The tables either side of this one already say so — `volunteer_signup` is
 * unique per (shift, member) and `volunteer_hour_log.minutes` carries a positive
 * CHECK — so a checklist cannot be modelled as more work orders. It has to sit a
 * level below one.
 *
 * Which is why this is four columns and stops. `doneByUserId` is attribution —
 * who says the trash went out — and never credit: hours belong to the work order
 * and nothing here touches them. A task that wants an assignee or a due date of
 * its own is not a task, it is a work order with a role.
 */
export const workTask = sqliteTable(
	'work_task',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// Cascade: a cancelled work order's checklist is noise the moment the work
		// order is gone, and nothing reads it afterwards.
		workOrderId: text('work_order_id')
			.notNull()
			.references(() => workOrder.id, { onDelete: 'cascade' }),

		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),

		done: integer('done', { mode: 'boolean' }).notNull().default(false),
		doneAt: integer('done_at', { mode: 'timestamp' }),
		// Set-null, which is exactly why the CHECK below constrains `done_at` and
		// not this: deleting an account must not make a ticked task unrepresentable.
		doneByUserId: text('done_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		// Earns its place here more than on most tables: checkboxes get toggled
		// constantly, and "when did this list last move" is the useful question.
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('work_task_order_idx').on(t.workOrderId, t.sortOrder),
		// `done` is NOT NULL, so neither branch can evaluate to NULL and slip
		// through — SQLite passes a CHECK that returns NULL.
		check(
			'work_task_done_has_time',
			sql`(done = 0 and done_at is null) or (done = 1 and done_at is not null)`
		)
	]
);

// ---------------------------------------------------------------------------
// Duty lists — a reusable set of work orders
// ---------------------------------------------------------------------------

/**
 * A named set of work orders, stamped onto an event.
 *
 * Staffing a show is six shifts, and today that is six passes through the modal
 * on the production page. This is that, once.
 *
 * It is a real table rather than the prototype pattern `recurring_series` uses,
 * for one reason: a past show's shift set is **not inert**. Point a template at
 * last month's show and someone cancelling a shift on it silently rewrites the
 * template. A prototype event survives that because nobody edits an event after
 * it happens; a roster is edited constantly. It is a table rather than a config
 * tuple for the adjacent reason — Facility and Programming own their own lists,
 * and a list you need a deploy to change is not owned by them.
 */
export const dutyList = sqliteTable(
	'duty_list',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull().unique(),
		description: text('description'),
		anchor: text('anchor', { enum: dutyListAnchors }).notNull().default('doors'),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
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
	(t) => [index('duty_list_active_idx').on(t.isActive, t.name)]
);

/**
 * One work order the list will produce, described relative to the anchor.
 *
 * The time columns **mirror the work order's own nullability**, which is what
 * lets one row type produce both halves of the show:
 *
 * - `offsetMinutes` + `durationMinutes` → a scheduled shift. Door, at doors.
 * - `dueOffsetMinutes` → an unscheduled work order with a `dueAt`. Booking Lead,
 *   a week out, whose tasks are the advance checklist.
 *
 * So there is no `phase` column and no "advance" concept: which phase a piece of
 * work belongs to is *which role's work order its tasks are on*, and the offset
 * says when. That is the difference the production spec was drawing when it
 * separated advance from day-of — who, and when — and roles plus offsets already
 * carry both.
 *
 * `tasks` is an ordered list of labels and nothing more: no identity, no foreign
 * keys, never queried across. They become `work_task` rows at apply time, and
 * until then they are strings — the same call `band_site.blocks` makes.
 */
export const dutyListItem = sqliteTable(
	'duty_list_item',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		dutyListId: text('duty_list_id')
			.notNull()
			.references(() => dutyList.id, { onDelete: 'cascade' }),
		// Restrict, matching `work_order.volunteerRoleId`: a list that names a
		// role staff deleted should fail loudly at the delete, not quietly at apply.
		volunteerRoleId: text('volunteer_role_id')
			.notNull()
			.references(() => volunteerRole.id, { onDelete: 'restrict' }),

		/** Signed, and measured from the list's anchor: negative is before it. */
		offsetMinutes: integer('offset_minutes'),
		durationMinutes: integer('duration_minutes'),
		/** Signed likewise. Deadline, not window: "done by Friday" is not "Friday 6-8". */
		dueOffsetMinutes: integer('due_offset_minutes'),

		capacity: integer('capacity').notNull().default(1),
		notes: text('notes'),
		sortOrder: integer('sort_order').notNull().default(0),
		tasks: text('tasks', { mode: 'json' }).$type<string[]>().notNull().default([]),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('duty_list_item_list_idx').on(t.dutyListId, t.sortOrder),
		// Compare null-ness rather than writing `(a is null and b is null) or ...`:
		// that form leaves one-set-one-null evaluating to `false OR NULL` = NULL,
		// and SQLite passes a CHECK that returns NULL. `(x is null)` always yields
		// 0 or 1, so this cannot leak. Same shape as
		// `volunteer_shift_ends_after_start`.
		check(
			'duty_list_item_window_paired',
			sql`(offset_minutes is null) = (duration_minutes is null)`
		),
		// Exactly one shape per item — a window or a deadline, never both and never
		// neither. Both would mean "Door 6-10pm, due Friday", which is not a thing.
		check(
			'duty_list_item_one_shape',
			sql`(offset_minutes is null) != (due_offset_minutes is null)`
		),
		check(
			'duty_list_item_duration_positive',
			sql`duration_minutes is null or duration_minutes > 0`
		),
		check('duty_list_item_capacity_positive', sql`capacity > 0`)
	]
);

export type VolunteerRole = typeof volunteerRole.$inferSelect;
export type VolunteerHourLog = typeof volunteerHourLog.$inferSelect;
export type VolunteerRoleInterest = typeof volunteerRoleInterest.$inferSelect;
export type VolunteerProfile = typeof volunteerProfile.$inferSelect;
export type WorkOrder = typeof workOrder.$inferSelect;
export type VolunteerSignup = typeof volunteerSignup.$inferSelect;
export type VolunteerShiftFeedback = typeof volunteerShiftFeedback.$inferSelect;
export type VolunteerCertification = typeof volunteerCertification.$inferSelect;
export type MemberCertification = typeof memberCertification.$inferSelect;
export type WorkTask = typeof workTask.$inferSelect;
export type DutyList = typeof dutyList.$inferSelect;
export type DutyListItem = typeof dutyListItem.$inferSelect;
