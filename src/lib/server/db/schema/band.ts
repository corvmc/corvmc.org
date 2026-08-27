import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { group } from './group';

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
// All that is left of the old band schema. The roster, its vocabularies and the
// slug history moved to `group.ts` in phase 2; `band_genre` folds into
// `directory_tag` in phase 3a, which deletes this file.

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
