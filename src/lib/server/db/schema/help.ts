import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

export const helpCategory = sqliteTable(
	'help_categories',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		icon: text('icon'),
		sortOrder: integer('sort_order').notNull().default(0),
		minRole: text('min_role').notNull().default('member'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [unique('help_categories_slug_unique').on(t.slug)]
);

export const helpArticle = sqliteTable(
	'help_articles',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		categoryId: text('category_id')
			.notNull()
			.references(() => helpCategory.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		slug: text('slug').notNull(),
		summary: text('summary'),
		content: text('content').notNull(),
		source: text('source').notNull().default('dynamic'),
		minRole: text('min_role').notNull().default('member'),
		/**
		 * Capabilities that admit a reader below `minRole`: holding any one is enough.
		 * For a staff article documenting a page a committee can be granted (#1638).
		 */
		capabilities: text('capabilities', { mode: 'json' }).$type<string[]>(),
		published: integer('published', { mode: 'boolean' }).notNull().default(false),
		sortOrder: integer('sort_order').notNull().default(0),
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
		unique('help_articles_slug_unique').on(t.slug),
		index('idx_help_articles_category').on(t.categoryId),
		index('idx_help_articles_published').on(t.published, t.minRole)
	]
);

export type HelpCategory = typeof helpCategory.$inferSelect;
export type HelpArticle = typeof helpArticle.$inferSelect;
