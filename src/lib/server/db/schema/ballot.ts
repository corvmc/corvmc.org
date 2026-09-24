import {
	sqliteTable,
	text,
	integer,
	index,
	uniqueIndex,
	primaryKey,
	check
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { group } from './group';
import { ballotKinds } from '../../../config';

/** Frozen at certification, so a later account purge cannot move a published result. */
export interface BallotCertifiedResult {
	options: Array<{ optionId: string; label: string; votes: number }>;
	turnout: number;
	electorateSize: number;
}

/**
 * One question, one choice per elector. See docs/specs/shipped/formal-balloting-spec.md.
 *
 * Lifecycle is derived from timestamps: draft until `opened_at`, closed once
 * `closes_at` passes, final once `certified_at` or `cancelled_at` is set.
 */
export const ballot = sqliteTable(
	'ballot',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		kind: text('kind', { enum: ballotKinds }).notNull(),
		/** The committee a `group` ballot belongs to. Null for a member-wide ballot. */
		groupId: text('group_id').references(() => group.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		closesAt: integer('closes_at', { mode: 'timestamp' }).notNull(),
		/** The one account that may certify. Null only after that account is purged. */
		certifierId: text('certifier_id').references(() => user.id, { onDelete: 'set null' }),
		createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),

		openedAt: integer('opened_at', { mode: 'timestamp' }),
		electorateSize: integer('electorate_size'),

		cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
		cancelReason: text('cancel_reason'),

		certifiedAt: integer('certified_at', { mode: 'timestamp' }),
		certifiedById: text('certified_by_id').references(() => user.id, { onDelete: 'set null' }),
		certifiedResult: text('certified_result', { mode: 'json' }).$type<BallotCertifiedResult>(),
		/** The fan-out latch: set by whichever delivery of `ballot.certified` notifies first. */
		resultPublishedAt: integer('result_published_at', { mode: 'timestamp' }),
		/** The same latch for the electors' "a ballot is open" notice. */
		openNoticeSentAt: integer('open_notice_sent_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('ballot_group_idx').on(t.groupId),
		index('ballot_closes_at_idx').on(t.closesAt),
		check('ballot_group_iff_group_kind', sql`(kind = 'group') = (group_id is not null)`),
		check('ballot_cancel_has_reason', sql`(cancelled_at is null) = (cancel_reason is null)`)
	]
);

export type Ballot = typeof ballot.$inferSelect;

export const ballotOption = sqliteTable(
	'ballot_option',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ballotId: text('ballot_id')
			.notNull()
			.references(() => ballot.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		position: integer('position').notNull()
	},
	(t) => [uniqueIndex('ballot_option_position_uq').on(t.ballotId, t.position)]
);

export type BallotOption = typeof ballotOption.$inferSelect;

/** The roll, written once by `INSERT … SELECT` when the ballot opens. */
export const ballotElector = sqliteTable(
	'ballot_elector',
	{
		ballotId: text('ballot_id')
			.notNull()
			.references(() => ballot.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.ballotId, t.userId] }),
		index('ballot_elector_user_idx').on(t.userId)
	]
);

/** A staff decision to include or exclude one member from a member-wide roll. Audited. */
export const ballotElectorOverride = sqliteTable(
	'ballot_elector_override',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		ballotId: text('ballot_id')
			.notNull()
			.references(() => ballot.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		include: integer('include', { mode: 'boolean' }).notNull(),
		reason: text('reason').notNull(),
		createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [uniqueIndex('ballot_elector_override_uq').on(t.ballotId, t.userId)]
);

// ---------------------------------------------------------------------------
// Secret ballots. These two tables must never become joinable:
// `ballot-secrecy.spec.ts` fails on a timestamp in either, a user reference in
// `ballot_choice`, or an option reference in `ballot_participation`.
// ---------------------------------------------------------------------------

/** That an elector voted — never what, and never when. */
export const ballotParticipation = sqliteTable(
	'ballot_participation',
	{
		ballotId: text('ballot_id')
			.notNull()
			.references(() => ballot.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.ballotId, t.userId] })]
);

/**
 * A counter per option, created at open and only ever incremented in place.
 * One row per vote would leak cast order through SQLite's implicit rowid.
 */
export const ballotChoice = sqliteTable(
	'ballot_choice',
	{
		ballotId: text('ballot_id')
			.notNull()
			.references(() => ballot.id, { onDelete: 'cascade' }),
		optionId: text('option_id')
			.notNull()
			.references(() => ballotOption.id, { onDelete: 'cascade' }),
		votes: integer('votes').notNull().default(0)
	},
	(t) => [
		primaryKey({ columns: [t.ballotId, t.optionId] }),
		check('ballot_choice_votes_nonnegative', sql`votes >= 0`)
	]
);

// ---------------------------------------------------------------------------
// Recorded ballots: who voted which way is the record, like minutes.
// ---------------------------------------------------------------------------

export const ballotRecordedVote = sqliteTable(
	'ballot_recorded_vote',
	{
		ballotId: text('ballot_id')
			.notNull()
			.references(() => ballot.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		optionId: text('option_id')
			.notNull()
			.references(() => ballotOption.id, { onDelete: 'cascade' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [primaryKey({ columns: [t.ballotId, t.userId] })]
);
