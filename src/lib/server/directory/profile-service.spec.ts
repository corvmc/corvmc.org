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
	},
	userInstrument: { userId: 'user_id', instrument: 'instrument' },
	userGenre: { userId: 'user_id', genre: 'genre' }
}));

vi.mock('$lib/server/db/schema/band', () => ({
	band: {
		id: 'id',
		tagline: 'tagline',
		lookingForMembers: 'looking_for_members',
		directoryVisibility: 'directory_visibility',
		directoryContact: 'directory_contact',
		links: 'links',
		updatedAt: 'updated_at'
	},
	bandMember: { bandId: 'band_id', userId: 'user_id', role: 'role', status: 'status' },
	bandGenre: { bandId: 'band_id', genre: 'genre' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn()
}));

vi.mock('$lib/server/storage', () => ({
	deleteObject: vi.fn().mockResolvedValue(undefined),
	uploadFile: vi.fn(async (_buffer: ArrayBuffer, key: string) => key)
}));

const { deleteObject, uploadFile } = await import('$lib/server/storage');
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
	it('updates user fields and replaces instruments/genres', async () => {
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
			lookingForBand: false
		});
		// Instruments and genres inserted
		expect(insertedRows).toHaveLength(2);
	});

	it('truncates bio to 2000 chars', async () => {
		const longBio = 'x'.repeat(3000);
		await updateMemberProfile('user-1', { bio: longBio });

		expect((updatedData[0] as any).bio).toHaveLength(2000);
	});

	it('truncates tagline to 150 chars', async () => {
		const longTagline = 'x'.repeat(200);
		await updateMemberProfile('user-1', { tagline: longTagline });

		expect((updatedData[0] as any).tagline).toHaveLength(150);
	});

	it('limits instruments to 20', async () => {
		const manyInstruments = Array.from({ length: 30 }, (_, i) => `inst-${i}`);
		await updateMemberProfile('user-1', { instruments: manyInstruments });

		const inserted = insertedRows[0] as any[];
		expect(inserted).toHaveLength(20);
	});

	it('validates links structure', async () => {
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

	it('returns profile with instruments and genres', async () => {
		selectResults.push([
			{
				bio: 'Hi',
				tagline: 'Dev',
				lookingForBand: true,
				directoryVisibility: 'public',
				directoryContact: null,
				links: null
			}
		]);
		selectResults.push([{ instrument: 'guitar' }, { instrument: 'drums' }]);
		selectResults.push([{ genre: 'rock' }]);

		const result = await getMemberProfileForEdit('user-1');

		expect(result).toMatchObject({
			bio: 'Hi',
			tagline: 'Dev',
			instruments: ['guitar', 'drums'],
			genres: ['rock']
		});
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

	it('updates band profile when user is admin', async () => {
		selectResults.push([{ role: 'admin' }]);

		await updateBandProfile('band-1', 'user-1', {
			tagline: 'Best band ever',
			genres: ['punk', 'ska'],
			lookingForMembers: true
		});

		expect(updatedData[0]).toMatchObject({
			tagline: 'Best band ever',
			lookingForMembers: true
		});
		expect(insertedRows).toHaveLength(1); // genres
	});

	it('round-trips hometown and foundedYear', async () => {
		selectResults.push([{ role: 'owner' }]);

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

		await updateBandProfile('band-1', 'user-1', { tagline: 'Only tagline' });

		expect(updatedData[0]).toMatchObject({ hometown: null, foundedYear: null });
	});
});

describe('setUserAvatar', () => {
	it('uploads the file and returns a cache-busting, extension-mapped key', async () => {
		selectResults.push([{ image: null }]);

		const key = await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');

		// The per-upload token is what stops a replaced avatar reusing its URL.
		expect(key).toMatch(/^users\/avatars\/user-1-[0-9a-f]{8}\.png$/);
		expect(uploadFile).toHaveBeenCalledWith(expect.any(ArrayBuffer), key, 'image/png');
	});

	it('deletes a previously-uploaded avatar key before replacing', async () => {
		selectResults.push([{ image: 'users/avatars/user-1.jpg' }]);

		await setUserAvatar('user-1', new ArrayBuffer(8), 'image/webp');

		expect(deleteObject).toHaveBeenCalledWith('users/avatars/user-1.jpg');
	});

	it('does not delete an external OAuth image URL', async () => {
		selectResults.push([{ image: 'https://lh3.googleusercontent.com/abc' }]);

		await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');

		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('clearUserAvatar', () => {
	it('deletes an uploaded avatar key', async () => {
		selectResults.push([{ image: 'users/avatars/user-1.png' }]);

		await clearUserAvatar('user-1');

		expect(deleteObject).toHaveBeenCalledWith('users/avatars/user-1.png');
	});

	it('does not delete an external OAuth image URL', async () => {
		selectResults.push([{ image: 'https://lh3.googleusercontent.com/abc' }]);

		await clearUserAvatar('user-1');

		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('getBandProfileForEdit', () => {
	it('returns null when band not found', async () => {
		selectResults.push([]);
		const result = await getBandProfileForEdit('nonexistent');
		expect(result).toBeNull();
	});

	it('returns band profile with genres', async () => {
		selectResults.push([
			{
				tagline: 'NYC punk',
				lookingForMembers: true,
				directoryVisibility: 'public',
				directoryContact: null,
				links: null
			}
		]);
		selectResults.push([{ genre: 'punk' }, { genre: 'rock' }]);

		const result = await getBandProfileForEdit('band-1');

		expect(result).toMatchObject({
			tagline: 'NYC punk',
			genres: ['punk', 'rock']
		});
	});
});
