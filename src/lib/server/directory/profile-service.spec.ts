import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResults: unknown[][] = [];
let selectCallIndex = 0;
const insertedRows: unknown[] = [];
let updatedData: unknown[] = [];

function buildChain() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				const result = selectResults[selectCallIndex] ?? [];
				selectCallIndex++;
				return (resolve: (v: unknown[]) => void) => resolve(result);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => buildChain(),
		update: () => {
			const chain: any = new Proxy(() => chain, {
				get(_, prop) {
					if (prop === 'set')
						return (data: unknown) => {
							updatedData.push(data);
							return chain;
						};
					if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(undefined);
					return () => chain;
				}
			});
			return chain;
		},
		delete: () => {
			return buildChain();
		},
		insert: () => ({
			values: (rows: unknown) => {
				insertedRows.push(rows);
				return Promise.resolve();
			}
		}),
		batch: (queries: unknown[]) => Promise.resolve(queries.map(() => undefined))
	}
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: {
		id: 'id',
		bio: 'bio',
		tagline: 'tagline',
		lookingForBand: 'looking_for_band',
		directoryVisibility: 'directory_visibility',
		directoryContact: 'directory_contact',
		links: 'links',
		updatedAt: 'updated_at'
	}
}));

vi.mock('$lib/server/db/schema/group', () => ({
	group: {
		id: 'id',
		tagline: 'tagline',
		lookingForMembers: 'looking_for_members',
		directoryVisibility: 'directory_visibility',
		directoryContact: 'directory_contact',
		links: 'links',
		updatedAt: 'updated_at'
	},
	groupMember: { groupId: 'group_id', userId: 'user_id', role: 'role', status: 'status' }
}));

// One table for what used to be three (`band_genre`, `user_genre`,
// `user_instrument`), which is why the mock has a `kind` column and the
// assertions below check it.
vi.mock('$lib/server/db/schema/directory', () => ({
	directoryEntry: {
		id: 'id',
		userId: 'user_id',
		groupId: 'group_id',
		name: 'name',
		tagline: 'tagline',
		hometown: 'hometown',
		foundedYear: 'founded_year',
		lookingFor: 'looking_for',
		visibility: 'visibility',
		contact: 'contact',
		links: 'links',
		updatedAt: 'updated_at'
	},
	directoryTag: { entryId: 'entry_id', kind: 'kind', value: 'value' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	sql: vi.fn()
}));

vi.mock('$lib/server/storage', () => ({
	deleteObject: vi.fn().mockResolvedValue(undefined),
	uploadFile: vi.fn(async (_buffer: ArrayBuffer, key: string) => key)
}));

vi.mock('$lib/server/media/media-service', () => ({
	replaceSlot: vi.fn().mockResolvedValue({ mediaId: 'm1', attachmentId: 'a1' }),
	detachSlot: vi.fn().mockResolvedValue(undefined)
}));

const { deleteObject, uploadFile } = await import('$lib/server/storage');
const { detachSlot, replaceSlot } = await import('$lib/server/media/media-service');
const {
	updateMemberProfile,
	getMemberProfileForEdit,
	updateBandProfile,
	getBandProfileForEdit,
	setUserAvatar,
	clearUserAvatar
} = await import('./profile-service');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	selectCallIndex = 0;
	insertedRows.length = 0;
	updatedData = [];
});

describe('updateMemberProfile', () => {
	it('updates the listing and replaces instruments/genres', async () => {
		selectResults.push([{ id: 'entry-1' }]); // getOrCreateUserEntryId

		await updateMemberProfile('user-1', {
			bio: 'Hello world',
			tagline: 'Musician',
			instruments: ['guitar', 'piano'],
			genres: ['rock', 'jazz']
		});

		expect(updatedData).toHaveLength(1);
		expect(updatedData[0]).toMatchObject({
			bio: 'Hello world',
			tagline: 'Musician',
			// The boolean became one end of a two-way column.
			lookingFor: null
		});
		// Instruments and genres inserted
		expect(insertedRows).toHaveLength(2);
	});

	it('kinds each tag, so genres and instruments cannot be confused', async () => {
		selectResults.push([{ id: 'entry-1' }]);

		await updateMemberProfile('user-1', { instruments: ['bass'], genres: ['jazz'] });

		// They share one table now. Without `kind`, a genre filter answers with
		// instruments and a genre save wipes them — and both still look like they
		// work.
		expect(insertedRows[0]).toEqual([{ entryId: 'entry-1', kind: 'instrument', value: 'bass' }]);
		expect(insertedRows[1]).toEqual([{ entryId: 'entry-1', kind: 'genre', value: 'jazz' }]);
	});

	it('truncates bio to 2000 chars', async () => {
		selectResults.push([{ id: 'entry-1' }]);
		const longBio = 'x'.repeat(3000);
		await updateMemberProfile('user-1', { bio: longBio });

		expect((updatedData[0] as any).bio).toHaveLength(2000);
	});

	it('truncates tagline to 150 chars', async () => {
		selectResults.push([{ id: 'entry-1' }]);
		const longTagline = 'x'.repeat(200);
		await updateMemberProfile('user-1', { tagline: longTagline });

		expect((updatedData[0] as any).tagline).toHaveLength(150);
	});

	it('limits instruments to 20', async () => {
		selectResults.push([{ id: 'entry-1' }]);
		const manyInstruments = Array.from({ length: 30 }, (_, i) => `inst-${i}`);
		await updateMemberProfile('user-1', { instruments: manyInstruments });

		const inserted = insertedRows[0] as any[];
		expect(inserted).toHaveLength(20);
	});

	it('validates links structure', async () => {
		selectResults.push([{ id: 'entry-1' }]);

		await updateMemberProfile('user-1', {
			links: [
				{ label: 'Website', url: 'https://example.com' },
				{ label: 'Twitter', url: 'https://twitter.com/test' }
			] as any
		});

		expect((updatedData[0] as any).links).toEqual([
			{ label: 'Website', url: 'https://example.com' },
			{ label: 'Twitter', url: 'https://twitter.com/test' }
		]);
	});
});

describe('getMemberProfileForEdit', () => {
	it('returns null when user not found', async () => {
		selectResults.push([]);
		const result = await getMemberProfileForEdit('nonexistent');
		expect(result).toBeNull();
	});

	it('returns profile with instruments and genres, in the shape the form speaks', async () => {
		selectResults.push([
			{
				id: 'entry-1',
				bio: 'Hi',
				tagline: 'Dev',
				lookingFor: 'band',
				visibility: 'public',
				contact: null,
				links: null
			}
		]);
		// One tag query now, split by `kind`, rather than one per table.
		selectResults.push([
			{ kind: 'instrument', value: 'guitar' },
			{ kind: 'instrument', value: 'drums' },
			{ kind: 'genre', value: 'rock' }
		]);

		const result = await getMemberProfileForEdit('user-1');

		expect(result).toMatchObject({
			bio: 'Hi',
			tagline: 'Dev',
			lookingForBand: true,
			directoryVisibility: 'public',
			directoryContact: null,
			instruments: ['guitar', 'drums'],
			genres: ['rock']
		});
		expect(result).not.toHaveProperty('id');
	});
});

describe('updateBandProfile', () => {
	it('throws when user is not admin or owner', async () => {
		// requireBandAdmin select returns member role
		selectResults.push([{ role: 'member' }]);

		await expect(updateBandProfile('band-1', 'user-1', { tagline: 'Great band' })).rejects.toThrow(
			'Not authorized'
		);
	});

	it('updates the band listing when user is admin', async () => {
		selectResults.push([{ role: 'admin' }]);
		selectResults.push([{ id: 'entry-1' }]); // getOrCreateGroupEntryId

		await updateBandProfile('band-1', 'user-1', {
			tagline: 'Best band ever',
			genres: ['punk', 'ska'],
			lookingForMembers: true
		});

		expect(updatedData[0]).toMatchObject({
			tagline: 'Best band ever',
			// The boolean became one end of a two-way column.
			lookingFor: 'members'
		});
		expect(insertedRows).toHaveLength(1); // genres
	});

	it('writes genres as genre-kinded tags on the entry', async () => {
		selectResults.push([{ role: 'admin' }]);
		selectResults.push([{ id: 'entry-1' }]);

		await updateBandProfile('band-1', 'user-1', { genres: ['punk', 'ska'] });

		// Without `kind` these rows are indistinguishable from a member's
		// instruments, and the directory would answer a genre filter with them.
		expect(insertedRows[0]).toEqual([
			{ entryId: 'entry-1', kind: 'genre', value: 'punk' },
			{ entryId: 'entry-1', kind: 'genre', value: 'ska' }
		]);
	});

	it('clears lookingFor rather than writing false', async () => {
		selectResults.push([{ role: 'owner' }]);
		selectResults.push([{ id: 'entry-1' }]);

		await updateBandProfile('band-1', 'user-1', { lookingForMembers: false });

		expect(updatedData[0]).toMatchObject({ lookingFor: null });
	});

	it('round-trips hometown and foundedYear', async () => {
		selectResults.push([{ role: 'owner' }]);
		selectResults.push([{ id: 'entry-1' }]);

		await updateBandProfile('band-1', 'user-1', {
			hometown: 'Corvallis, OR',
			foundedYear: '2019'
		});

		expect(updatedData[0]).toMatchObject({
			hometown: 'Corvallis, OR',
			foundedYear: '2019'
		});
	});

	it('nulls hometown and foundedYear when omitted (why the edit form must submit them)', async () => {
		selectResults.push([{ role: 'owner' }]);
		selectResults.push([{ id: 'entry-1' }]);

		await updateBandProfile('band-1', 'user-1', { tagline: 'Only tagline' });

		expect(updatedData[0]).toMatchObject({ hometown: null, foundedYear: null });
	});
});

describe('setUserAvatar', () => {
	it('uploads the file and returns a cache-busting, extension-mapped key', async () => {
		const key = await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');

		// The per-upload token is what stops a replaced avatar reusing its URL.
		expect(key).toMatch(/^users\/avatars\/user-1-[0-9a-f]{8}\.png$/);
		expect(uploadFile).toHaveBeenCalledWith(expect.any(ArrayBuffer), key, 'image/png');
	});

	it('records the new object and releases the slot, without deleting anything', async () => {
		// The replacement used to delete the previous object inline. It cannot:
		// this request has no way to know whether something else still points at
		// it, so the sweep decides. See docs/specs/media-spec.md.
		await setUserAvatar('user-1', new ArrayBuffer(8), 'image/webp');

		expect(replaceSlot).toHaveBeenCalledWith(
			expect.objectContaining({ attachableType: 'user', attachableId: 'user-1', slot: 'avatar' })
		);
		expect(deleteObject).not.toHaveBeenCalled();
	});

	it('needs no OAuth-URL guard any more', async () => {
		// `user.image` may hold a provider URL rather than a key, which the old
		// inline delete had to special-case. A provider URL was never an R2 object
		// and so never had a `media` row — there is nothing to detach and nothing
		// to guard.
		await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');

		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('clearUserAvatar', () => {
	it('detaches the slot rather than deleting the object', async () => {
		await clearUserAvatar('user-1');

		expect(detachSlot).toHaveBeenCalledWith('user', 'user-1', 'avatar');
		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('getBandProfileForEdit', () => {
	it('returns null when band not found', async () => {
		selectResults.push([]);
		const result = await getBandProfileForEdit('nonexistent');
		expect(result).toBeNull();
	});

	it('returns band profile with genres, in the shape the form already speaks', async () => {
		selectResults.push([
			{
				id: 'entry-1',
				tagline: 'NYC punk',
				lookingFor: 'members',
				visibility: 'public',
				contact: null,
				links: null
			}
		]);
		selectResults.push([{ value: 'punk' }, { value: 'rock' }]);

		const result = await getBandProfileForEdit('band-1');

		// The entry's column names are translated back here rather than in the
		// form: phase 3a is a server-side port, and no `.svelte` file learns that
		// the listing changed tables.
		expect(result).toMatchObject({
			tagline: 'NYC punk',
			lookingForMembers: true,
			directoryVisibility: 'public',
			directoryContact: null,
			genres: ['punk', 'rock']
		});
		expect(result).not.toHaveProperty('id');
	});
});
