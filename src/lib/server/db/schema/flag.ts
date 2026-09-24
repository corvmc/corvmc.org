import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Content flag domain types
// ---------------------------------------------------------------------------

export const flagEntityTypes = [
	'member_profile',
	'band_profile',
	'event',
	'suggestion',
	'inbox_thread',
	'classified_post'
] as const;
export type FlagEntityType = (typeof flagEntityTypes)[number];

/**
 * What the shared member report form (`submitFlag`) is allowed to target.
 *
 * Deliberately narrower than `flagEntityTypes`. `submitFlag` takes its entity
 * type and id straight from the browser and checks nothing about the reporter's
 * relationship to the target — fine for a public profile or listing, wrong for
 * anything where reporting has side effects or grants access.
 *
 * The two absentees each have their own remote for exactly that reason:
 *
 *  - `inbox_thread` — filing the report is what makes a private conversation
 *    readable by staff, so any member could expose a stranger's DMs by guessing
 *    a thread id. `reportDirectThread` verifies the reporter is in it.
 *  - `suggestion` — reporting pulls the suggestion off the board as a side
 *    effect. `flagSuggestion` rate-limits and maps its own errors.
 *
 * Add to this list only when a plain "anyone signed in may report this by id"
 * is genuinely safe for the entity.
 */
export const memberReportableEntityTypes = ['member_profile', 'band_profile', 'event'] as const;
export type MemberReportableEntityType = (typeof memberReportableEntityTypes)[number];

export const flagStatuses = ['pending', 'resolved', 'dismissed'] as const;
export type FlagStatus = (typeof flagStatuses)[number];

/**
 * `staff_action` is a staffer recording why they acted on their own initiative:
 * filed already resolved, so it never enters the queue or notifies anyone.
 */
export const flagOrigins = ['report', 'staff_action'] as const;
export type FlagOrigin = (typeof flagOrigins)[number];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const contentFlag = sqliteTable(
	'content_flag',
	{
		id: text()
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// Polymorphic target (member profile, band profile, or event). Drizzle v1
		// lacks polymorphic relations, so we store a type discriminator + entity
		// id, matching the reservation.bookerType / bookerId pattern.
		entityType: text('entity_type', { enum: flagEntityTypes }).notNull(),
		entityId: text('entity_id').notNull(),

		// Null for anonymous public reports (event listings are reportable by
		// anyone, Turnstile-gated). set-null keeps reports through account deletion.
		reportedByUserId: text('reported_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		reason: text('reason').notNull(),
		description: text('description'),

		origin: text('origin', { enum: flagOrigins }).notNull().default('report'),
		status: text('status', { enum: flagStatuses }).notNull().default('pending'),
		resolvedByUserId: text('resolved_by_user_id').references(() => user.id, {
			onDelete: 'set null'
		}),
		resolutionNotes: text('resolution_notes'),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		resolvedAt: integer('resolved_at', { mode: 'timestamp' })
	},
	(t) => [
		index('content_flag_status_idx').on(t.status),
		index('content_flag_entity_idx').on(t.entityType, t.entityId)
	]
);

export type ContentFlag = typeof contentFlag.$inferSelect;
