import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { group } from './group';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
// All that is left of the old band schema. The roster, its vocabularies and the
// slug history moved to `group.ts` in phase 2.
//
// `band_genre` folded into `directory_tag` in phase 3a and **nothing reads or
// writes it any more** — `scripts/no-directory-tag-tables.spec.ts` keeps it that
// way. The declaration survives only because removing it would make
// `pnpm db:generate` emit `DROP TABLE`, and 3a deliberately drops nothing: the
// rows are the recovery path until the readers have run against `directory_tag`
// for a release. Phase 3c deletes this file and generates that migration.

export const bandGenre = sqliteTable(
	'band_genre',
	{
		bandId: text('band_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		genre: text('genre').notNull()
	},
	(t) => [index('idx_band_genre_band').on(t.bandId)]
);
