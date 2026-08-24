import { describe, it, expect, vi, beforeEach } from 'vitest';

// getPublicDirectory aggregates listPublicMembers + listPublicBands, which hit
// D1 via `db.query.*.findMany` and R2 via resolveImageUrl. Mock at those
// boundaries so the real aggregation/try-catch runs without a DB or storage.
const { userFindMany, userFindFirst, bandFindMany, captureException } = vi.hoisted(() => ({
	userFindMany: vi.fn(),
	userFindFirst: vi.fn(),
	bandFindMany: vi.fn(),
	captureException: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			user: { findMany: userFindMany, findFirst: userFindFirst },
			group: { findMany: bandFindMany }
		}
	}
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));
vi.mock('$lib/server/sentry', () => ({ captureException }));

import { getPublicDirectory, listMembers, listBands, isProfileComplete } from './directory-service';

/** Pull the `AND` condition array out of the `where` passed to a findMany mock. */
function whereConditions(mock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
	const arg = mock.mock.calls[0]?.[0] as { where?: { AND?: Record<string, unknown>[] } };
	return arg?.where?.AND ?? [];
}

describe('member filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		userFindMany.mockResolvedValue([]);
	});

	it('passes each flag filter through as an equality condition', async () => {
		await listMembers({
			lookingForBand: true,
			availableForHire: true,
			teachesLessons: true,
			openToCollaboration: true
		});
		const conds = whereConditions(userFindMany);
		expect(conds).toContainEqual({ lookingForBand: true });
		expect(conds).toContainEqual({ availableForHire: true });
		expect(conds).toContainEqual({ teachesLessons: true });
		expect(conds).toContainEqual({ openToCollaboration: true });
	});

	it('omits flag conditions that are not set', async () => {
		await listMembers({ lookingForBand: true });
		const conds = whereConditions(userFindMany);
		expect(conds).toContainEqual({ lookingForBand: true });
		expect(conds).not.toContainEqual({ availableForHire: true });
		expect(conds).not.toContainEqual({ openToCollaboration: true });
	});

	it('turns a search term into a name LIKE condition', async () => {
		await listMembers({ search: 'jeff' });
		expect(whereConditions(userFindMany)).toContainEqual({ name: { like: '%jeff%' } });
	});
});

describe('band filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		bandFindMany.mockResolvedValue([]);
	});

	it('passes lookingForMembers through and applies a name search', async () => {
		await listBands({ lookingForMembers: true, search: 'trio' });
		const conds = whereConditions(bandFindMany);
		expect(conds).toContainEqual({ lookingForMembers: true });
		expect(conds).toContainEqual({ name: { like: '%trio%' } });
	});
});

describe('getPublicDirectory', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a safe fallback (does not reject) when an underlying query throws', async () => {
		userFindMany.mockRejectedValue(new Error('D1 boom'));
		bandFindMany.mockResolvedValue([]);

		const result = await getPublicDirectory({});

		expect(result).toEqual({ members: [], bands: [], failed: true });
		expect(captureException).toHaveBeenCalledOnce();
	});

	it('returns members and bands with failed=false on success', async () => {
		userFindMany.mockResolvedValue([]);
		bandFindMany.mockResolvedValue([]);

		const result = await getPublicDirectory({});

		expect(result.members).toEqual([]);
		expect(result.bands).toEqual([]);
		expect(result.failed).toBe(false);
		expect(captureException).not.toHaveBeenCalled();
	});
});

describe('isProfileComplete', () => {
	const blank = { tagline: null, bio: null, image: null, instruments: [], genres: [] };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is false for a brand-new account with nothing filled in', async () => {
		userFindFirst.mockResolvedValue(blank);
		await expect(isProfileComplete('u1')).resolves.toBe(false);
	});

	it('is false when a missing user means there is no profile at all', async () => {
		userFindFirst.mockResolvedValue(undefined);
		await expect(isProfileComplete('nobody')).resolves.toBe(false);
	});

	it.each([
		['a tagline', { tagline: 'Bassist | Post-punk' }],
		['a bio', { bio: '<p>Moved here in 2025.</p>' }],
		['an avatar', { image: 'avatars/u1.png' }],
		['one instrument', { instruments: [{ instrument: 'bass' }] }],
		['one genre', { genres: [{ genre: 'post-punk' }] }]
	])('is true once the member has %s', async (_label, patch) => {
		userFindFirst.mockResolvedValue({ ...blank, ...patch });
		await expect(isProfileComplete('u1')).resolves.toBe(true);
	});

	it('treats whitespace-only text as still blank', async () => {
		userFindFirst.mockResolvedValue({ ...blank, tagline: '   ', bio: '\n\t' });
		await expect(isProfileComplete('u1')).resolves.toBe(false);
	});
});
