import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import { suggestionCategories, suggestionStatuses, suggestionVisibilities } from '../../../config';

// ---------------------------------------------------------------------------
// Suggestion domain types
// ---------------------------------------------------------------------------

// The vocabularies live in $lib/config so client code can label them without
// importing the schema, matching volunteer.ts. The derived types are exported
// from here, which is where the rest of the server reaches for them.
export type SuggestionCategory = (typeof suggestionCategories)[number];
export type SuggestionStatus = (typeof suggestionStatuses)[number];

/**
 * Whether the suggestion is on the board at all. Deliberately a separate axis
 * from `status`: a public "Declined, here's why" and a silent takedown must not
 * be the same state, or members can't tell a decision from a disappearance.
 *
 * - `visible`        on the board
 * - `pending_review` never been public — the author is posting under review
 * - `under_review`   was public, pulled by a member's report
 * - `hidden`         staff takedown (or an upheld report)
 */
export type SuggestionVisibility = (typeof suggestionVisibilities)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const suggestion = sqliteTable(
	'suggestion',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// set-null so a deleted account doesn't take community history with it,
		// matching contentFlag.reportedByUserId.
		authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
		title: text('title').notNull(),
		body: text('body').notNull(),
		category: text('category', { enum: suggestionCategories }).notNull().default('other'),

		status: text('status', { enum: suggestionStatuses }).notNull().default('open'),

		visibility: text('visibility', { enum: suggestionVisibilities }).notNull().default('visible'),
		/** Staff's reason, shown to the author. */
		visibilityNote: text('visibility_note'),
		visibilityChangedAt: integer('visibility_changed_at', { mode: 'timestamp' }),
		/** Null when the system moved it — e.g. an incoming report withholding a post. */
		visibilityChangedByUserId: text('visibility_changed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		/** The single public staff response. Editable in place; no history table. */
		responseBody: text('response_body'),
		responseByUserId: text('response_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		responseAt: integer('response_at', { mode: 'timestamp' }),

		// Non-null means merged. No FK: nothing else in the schema self-references,
		// and `scripts/db/d1-safe-rebuild.mjs` walks a child graph on every
		// db:generate that has never had to order a table against itself. Mirrors
		// contentFlag.entityId, which is FK-less for the same "don't fight the
		// tooling" reason. The service validates the target instead.
		/**
		 * Set the first time the text changes, so the board can say "edited"
		 * without anyone having to diff it. Null means the words on screen are the
		 * words people voted for.
		 */
		editedAt: integer('edited_at', { mode: 'timestamp' }),

		mergedIntoId: text('merged_into_id'),
		mergedByUserId: text('merged_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		mergedAt: integer('merged_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('suggestion_status_idx').on(t.status),
		index('suggestion_category_idx').on(t.category),
		index('suggestion_visibility_idx').on(t.visibility),
		index('suggestion_author_idx').on(t.authorUserId),
		index('suggestion_merged_into_idx').on(t.mergedIntoId),
		index('suggestion_created_idx').on(t.createdAt)
	]
);

/**
 * One upvote per member per suggestion. The unique index is the backstop for
 * double-submits AND the dedup that makes merging duplicates honest — the
 * transfer inserts the source's voters onto the target and lets this index
 * throw away anyone who had already voted there.
 */
export const suggestionVote = sqliteTable(
	'suggestion_vote',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		suggestionId: text('suggestion_id')
			.notNull()
			.references(() => suggestion.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_suggestion_vote_suggestion_user').on(t.suggestionId, t.userId),
		index('idx_suggestion_vote_user').on(t.userId)
	]
);

export const suggestionEditStatuses = ['pending', 'approved', 'rejected'] as const;
export type SuggestionEditStatus = (typeof suggestionEditStatuses)[number];

/**
 * A proposed change to a suggestion that already has votes behind it.
 *
 * An author can rewrite their own suggestion freely right up until somebody
 * else upvotes it. After that the words are what other members put their name
 * to, and changing them silently is a bait-and-switch: post something popular,
 * collect the votes, then swap in what you actually wanted. So once a vote
 * lands from anyone but the author, an edit stops being a write and becomes
 * this — a request staff approve or reject.
 *
 * Both the proposed text and a snapshot of what it would replace are stored, so
 * staff review an actual before/after rather than guessing what changed. The
 * snapshot is taken at request time and deliberately not refreshed: if the
 * suggestion moved underneath the request, staff should see the text the author
 * was actually looking at.
 */
export const suggestionEdit = sqliteTable(
	'suggestion_edit',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		suggestionId: text('suggestion_id')
			.notNull()
			.references(() => suggestion.id, { onDelete: 'cascade' }),
		requestedByUserId: text('requested_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),

		proposedTitle: text('proposed_title').notNull(),
		proposedBody: text('proposed_body').notNull(),
		proposedCategory: text('proposed_category', { enum: suggestionCategories }).notNull(),

		originalTitle: text('original_title').notNull(),
		originalBody: text('original_body').notNull(),
		originalCategory: text('original_category', { enum: suggestionCategories }).notNull(),

		status: text('status', { enum: suggestionEditStatuses }).notNull().default('pending'),
		reviewedByUserId: text('reviewed_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		reviewNotes: text('review_notes'),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('suggestion_edit_suggestion_idx').on(t.suggestionId),
		index('suggestion_edit_status_idx').on(t.status),
		index('suggestion_edit_requested_by_idx').on(t.requestedByUserId)
	]
);

export type Suggestion = typeof suggestion.$inferSelect;
export type SuggestionVote = typeof suggestionVote.$inferSelect;
export type SuggestionEdit = typeof suggestionEdit.$inferSelect;
