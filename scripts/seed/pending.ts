import {
	type DirectoryContact,
	type DirectoryVisibility,
	type ProfileLink
} from '../../src/lib/server/db/schema/authentication';
import { bandSite } from '../../src/lib/server/db/schema/band-site';

/**
 * Tags collected while users and bands are seeded, keyed by the SUBJECT id.
 *
 * `directory_tag` hangs off the entry, and entries are created at the very end
 * from everything in the database — so the tags cannot be written at the same
 * moment as the user or band they describe. Collecting them here keeps that one
 * ordering constraint in one place instead of making each seed function know
 * about entries.
 */
export const pendingTags: { subjectId: string; kind: 'genre' | 'instrument'; value: string }[] = [];

/**
 * Listing fields collected while users and bands are seeded, keyed by SUBJECT id.
 *
 * These used to be read back off `user` and `group`, which worked while the
 * columns were still there to read. Phase 3c drops them, so the values have to
 * travel from the place that invents them to the place that writes the entry —
 * the same shape `pendingTags` already uses, and for the same reason.
 */
export type PendingEntry = {
	bio?: string | null;
	tagline?: string | null;
	hometown?: string | null;
	foundedYear?: string | null;
	links?: ProfileLink[] | null;
	visibility?: DirectoryVisibility;
	contact?: DirectoryContact;
	lookingFor?: 'members' | 'band' | null;
	availableForHire?: boolean;
	teachesLessons?: boolean;
	openToCollaboration?: boolean;
};

export const pendingEntries = new Map<string, PendingEntry>();

/**
 * The premium half, keyed by band id, for the same reason `pendingEntries`
 * exists: phase 3c drops `tier`, `subscription` and the five `customDomain*`
 * columns from `group`, so they travel from the band seeder to
 * `seedBandSites` rather than being read back off the group row.
 */
export type PendingSite = Partial<typeof bandSite.$inferInsert>;

export const pendingSites = new Map<string, PendingSite>();
