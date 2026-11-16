import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { contentFlag } from './flag';
import {
	appealOutcomes,
	blocklistSources,
	removalKinds,
	removalLiftReasons
} from '../../../config';

// ---------------------------------------------------------------------------
// Moderation domain types
// ---------------------------------------------------------------------------

/** Why a block exists. Shown to staff for context; never to the blocked person. */
export const userBlockSources = ['manual', 'declined_request', 'reported'] as const;
export type UserBlockSource = (typeof userBlockSources)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * "I don't want to hear from this person."
 *
 * Rows point one way, but every check looks both ways — so one row is enough,
 * and two (both parties blocking) change nothing. Unblocking deletes the row:
 * unlike `member_standing` this is a live preference rather than a staff
 * decision, so there is no history worth preserving.
 *
 * Blocking is enforced on send, reply and accept. It is deliberately NOT
 * enforced on reads — the person who blocked still needs the conversation in
 * order to report it.
 */
export const userBlock = sqliteTable(
	'user_block',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		blockerUserId: text('blocker_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		blockedUserId: text('blocked_user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		source: text('source', { enum: userBlockSources }).notNull().default('manual'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_user_block_pair').on(t.blockerUserId, t.blockedUserId),
		index('idx_user_block_blocked').on(t.blockedUserId)
	]
);

export type UserBlock = typeof userBlock.$inferSelect;

/**
 * A member contesting an upheld report — the decision, not the report itself.
 *
 * `decidedAt IS NULL` is the pending predicate; there is no status column, and
 * the verdict a person reads is derived from the two outcomes (`appealVerdict`).
 * One row per flag, enforced here: staff reopen by clearing the decision, so a
 * member can never file twice. See
 * `docs/decisions/0039-moderation-appeals-hang-off-the-upheld-report.md`.
 */
export const moderationAppeal = sqliteTable(
	'moderation_appeal',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		flagId: text('flag_id')
			.notNull()
			.references(() => contentFlag.id, { onDelete: 'cascade' }),
		appellantUserId: text('appellant_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		body: text('body').notNull(),
		/** Set only when the report removed the account; null on every other appeal. */
		accountOutcome: text('account_outcome', { enum: appealOutcomes }),
		contentOutcome: text('content_outcome', { enum: appealOutcomes }),
		standingOutcome: text('standing_outcome', { enum: appealOutcomes }),
		/** Shown to the member. */
		decisionNotes: text('decision_notes'),
		decidedByUserId: text('decided_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		decidedAt: integer('decided_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_moderation_appeal_flag').on(t.flagId),
		index('idx_moderation_appeal_decided_at').on(t.decidedAt),
		index('idx_moderation_appeal_appellant').on(t.appellantUserId)
	]
);

export type ModerationAppeal = typeof moderationAppeal.$inferSelect;

/** What a removal undid, so lifting it gives back exactly that and nothing else. */
export interface RemovalLedger {
	reservationIds: string[];
	doorCodeIds: string[];
	billing: 'paused' | 'cancel_at_period_end' | 'none';
}

/**
 * One row per suspension or ban, never upserted. `user.deletedAt` stays the
 * only enforcement predicate; this row explains it. The open removal is the
 * row with no `liftedAt`, and the partial unique index allows one per member.
 * Every row carries the upheld report it rests on, which is what an appeal
 * attaches to.
 */
export const accountRemoval = sqliteTable(
	'account_removal',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
		kind: text('kind', { enum: removalKinds }).notNull(),
		reason: text('reason').notNull(),
		flagId: text('flag_id')
			.notNull()
			.references(() => contentFlag.id),
		/** Suspensions only. */
		endsAt: integer('ends_at', { mode: 'timestamp' }),
		ledger: text('ledger', { mode: 'json' }).$type<RemovalLedger>(),
		liftedAt: integer('lifted_at', { mode: 'timestamp' }),
		liftedByUserId: text('lifted_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		liftReason: text('lift_reason', { enum: removalLiftReasons }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('uq_account_removal_open')
			.on(t.userId)
			.where(sql`lifted_at IS NULL`),
		index('idx_account_removal_flag').on(t.flagId),
		index('idx_account_removal_ends_at').on(t.endsAt)
	]
);

export type AccountRemoval = typeof accountRemoval.$inferSelect;

/**
 * Addresses that may not create an account. No FK to `user`: purging a banned
 * member must not free the address. Stored lowercased and trimmed.
 * `refusedCount` and `lastRefusedAt` are what staff see of refused sign-ups.
 */
export const emailBlocklist = sqliteTable('email_blocklist', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull().unique(),
	source: text('source', { enum: blocklistSources }).notNull(),
	note: text('note'),
	removalId: text('removal_id').references(() => accountRemoval.id, { onDelete: 'set null' }),
	addedByUserId: text('added_by_user_id').references(() => user.id, { onDelete: 'set null' }),
	refusedCount: integer('refused_count').notNull().default(0),
	lastRefusedAt: integer('last_refused_at', { mode: 'timestamp' }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

export type EmailBlocklistEntry = typeof emailBlocklist.$inferSelect;
