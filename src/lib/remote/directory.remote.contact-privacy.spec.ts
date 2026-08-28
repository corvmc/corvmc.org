import { describe, it, expect, vi, beforeEach } from 'vitest';

// `getPublicMemberProfile` is the public-facing endpoint, so it must never
// surface a member's members-only contact details. We exercise the *real*
// handler: `$app/server` is a SvelteKit virtual module, so we mock `query`/
// `form` as pass-throughs that hand back the raw handler. The handler must be
// tagged with a `__` marker so the kit plugin's remote-function init
// validation accepts the export. The DB is mocked at the same boundary the
// service test uses.
const { entryFindFirst } = vi.hoisted(() => ({ entryFindFirst: vi.fn() }));

vi.mock('$app/server', () => ({
	query: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	},
	form: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	getRequestEvent: () => ({ locals: {} })
}));
// The member listing moved to `directory_entry` in phase 3a; the contact
// details this spec guards moved with it, from `user.directoryContact` to
// `directory_entry.contact`.
vi.mock('$lib/server/db', () => ({
	db: {
		query: {
			directoryEntry: { findFirst: entryFindFirst, findMany: vi.fn() }
		}
	}
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/authorization', () => ({ requireUser: () => ({ id: 'u1' }) }));
vi.mock('$lib/server/group/group-context', () => ({ requireGroupRole: vi.fn() }));

import { getPublicMemberProfile } from './directory.remote';

/**
 * A member who IS in the public directory (passed the visibility WHERE), shaped
 * as the entry row the query now returns: identity and avatar come from the
 * joined `user`, the listing fields from the entry itself.
 */
const baseRow = {
	userId: 'm1',
	name: 'Jeff',
	bio: null,
	tagline: null,
	hometown: null,
	lookingFor: null,
	availableForHire: false,
	teachesLessons: false,
	openToCollaboration: false,
	contact: null as Record<string, unknown> | null,
	links: null,
	tags: [],
	user: {
		memberNumber: 1,
		pronouns: null,
		image: null,
		createdAt: new Date(0),
		groupMembers: []
	}
};

describe('getPublicMemberProfile contact privacy', () => {
	beforeEach(() => vi.clearAllMocks());

	it('withholds members-only contact details from the public profile', async () => {
		entryFindFirst.mockResolvedValue({
			...baseRow,
			contact: { email: 'secret@jeff.com', phone: '555-9999', visibility: 'members' }
		});

		const { member } = await getPublicMemberProfile('m1');

		expect(member.directoryContact).toBeNull();
		// Belt-and-suspenders: the secrets must not leak anywhere in the payload,
		// even if a future change reshapes the DTO.
		const serialized = JSON.stringify(member);
		expect(serialized).not.toContain('secret@jeff.com');
		expect(serialized).not.toContain('555-9999');
	});

	it('treats contact with no visibility set as members-only (default)', async () => {
		entryFindFirst.mockResolvedValue({
			...baseRow,
			contact: { email: 'secret@jeff.com' }
		});

		const { member } = await getPublicMemberProfile('m1');

		expect(member.directoryContact).toBeNull();
		expect(JSON.stringify(member)).not.toContain('secret@jeff.com');
	});

	it('exposes contact only when the member explicitly opted it public', async () => {
		entryFindFirst.mockResolvedValue({
			...baseRow,
			contact: { email: 'book@jeff.com', visibility: 'public' }
		});

		const { member } = await getPublicMemberProfile('m1');

		expect(member.directoryContact).toEqual({ email: 'book@jeff.com', visibility: 'public' });
	});
});
