import { sqliteTable, text, integer, index, unique, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

/**
 * Why a subscriber is globally suppressed. `bounce` and `complaint` are set by
 * Postmark webhooks; `unsubscribe` is the recipient choosing "unsubscribe from
 * all" on the unsubscribe page. The distinction matters: a self-service opt-out
 * can be reversed by opting back in, a broken or complaining address cannot.
 */
export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe';

export const subscriber = sqliteTable(
	'subscriber',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		email: text('email').notNull().unique(),
		name: text('name'),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		// Global (cross-audience) suppression. Null = deliverable. Distinct from
		// per-audience opt-out (audienceMember.unsubscribedAt): this excludes the
		// address from every campaign regardless of any audience membership, which
		// is what makes it the right home for "unsubscribe from all".
		suppressedAt: integer('suppressed_at', { mode: 'timestamp' }),
		suppressionReason: text('suppression_reason').$type<SuppressionReason>(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [index('idx_subscriber_user').on(t.userId)]
);

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export const audience = sqliteTable('audience', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	description: text('description'),
	allowOptIn: integer('allow_opt_in', { mode: 'boolean' }).notNull().default(false),
	// Non-null marks a built-in audience whose membership is resolved by a
	// code-defined SQL predicate at query time rather than from audience_member
	// rows. See marketing/system-audiences.ts. Null = staff-curated static list.
	systemKey: text('system_key').unique(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

// ---------------------------------------------------------------------------
// Audience members
// ---------------------------------------------------------------------------

export const audienceMember = sqliteTable(
	'audience_member',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		subscriberId: text('subscriber_id')
			.notNull()
			.references(() => subscriber.id, { onDelete: 'cascade' }),
		audienceId: text('audience_id')
			.notNull()
			.references(() => audience.id, { onDelete: 'cascade' }),
		unsubscribedAt: integer('unsubscribed_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		unique('uq_audience_member').on(t.subscriberId, t.audienceId),
		index('idx_audience_member_active')
			.on(t.audienceId)
			.where(sql`unsubscribed_at IS NULL`)
	]
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const campaign = sqliteTable(
	'campaign',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		subject: text('subject').notNull(),
		markdownBody: text('markdown_body').notNull(),
		htmlBody: text('html_body').notNull(),
		scheduledFor: integer('scheduled_for', { mode: 'timestamp' }),
		sentAt: integer('sent_at', { mode: 'timestamp' }),
		sentById: text('sent_by_id')
			.notNull()
			.references(() => user.id),
		/**
		 * The show this blast is about, when it is about one (#857). The only
		 * thing that makes the `event-interest` audience resolve to anybody;
		 * null on every other campaign, and that audience then matches nobody
		 * rather than everybody. Bare `text`, because a foreign key onto an
		 * existing table is a rebuild and `campaign_audience` cascades off this.
		 */
		eventId: text('event_id'),
		recipientCount: integer('recipient_count'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_campaign_pending_send')
			.on(t.scheduledFor)
			.where(sql`sent_at IS NULL`),
		index('idx_campaign_sent_by').on(t.sentById),
		index('idx_campaign_event').on(t.eventId)
	]
);

// ---------------------------------------------------------------------------
// Campaign ↔ Audience join
// ---------------------------------------------------------------------------

export const campaignAudience = sqliteTable(
	'campaign_audience',
	{
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaign.id, { onDelete: 'cascade' }),
		audienceId: text('audience_id')
			.notNull()
			.references(() => audience.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.campaignId, t.audienceId] })]
);

// ---------------------------------------------------------------------------
// Client-safe serialized types
// ---------------------------------------------------------------------------

export type Audience = typeof audience.$inferSelect;
