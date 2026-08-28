import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const requireUser = vi.fn(() => ({ id: 'user-1' }));
const hasAnyRole = vi.fn(async () => false);
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => requireUser(),
	hasAnyRole: (...a: unknown[]) => hasAnyRole(...(a as []))
}));

// Typed with their parameters so the D1-rejecting overrides below are
// assignable; a zero-arg `vi.fn` narrows the mock to `() => …` and rejects it.
const getBySlug = vi.fn(async (_slug: unknown) => null as unknown);
const getByIdActive = vi.fn(async (_id: unknown) => null as unknown);
const getUserRole = vi.fn(async () => null as unknown);
vi.mock('$lib/server/band/band-service', () => ({
	getBySlug: (slug: unknown) => getBySlug(slug),
	getByIdActive: (id: unknown) => getByIdActive(id),
	getUserRole: (...a: unknown[]) => getUserRole(...(a as []))
}));

import { requireGroupRole } from './group-context';

const GROUP = { id: 'group-1', slug: 'our-band', name: 'Our Band' };

beforeEach(() => {
	for (const m of [getBySlug, getByIdActive, getUserRole, hasAnyRole]) m.mockReset();
	getBySlug.mockResolvedValue(null);
	getByIdActive.mockResolvedValue(null);
	getUserRole.mockResolvedValue(null);
	hasAnyRole.mockResolvedValue(false);
});

/** Pull the status off a thrown kit `HttpError` without depending on its class. */
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status ?? 0;
	}
	throw new Error('expected the guard to throw, but it resolved');
}

describe('requireGroupRole', () => {
	describe('resolving the ref', () => {
		it('resolves a slug ref through getBySlug', async () => {
			getBySlug.mockResolvedValue(GROUP);
			getUserRole.mockResolvedValue('member');

			await expect(requireGroupRole({ slug: 'our-band' }, 'member')).resolves.toEqual({
				user: { id: 'user-1' },
				group: GROUP,
				role: 'member'
			});
			expect(getBySlug).toHaveBeenCalledWith('our-band');
			expect(getByIdActive).not.toHaveBeenCalled();
		});

		/**
		 * `getByIdActive`, not `getById`: the latter is a bare row read that does
		 * not exclude soft-deleted groups, and a guard must not resolve one.
		 */
		it('resolves an id ref through getByIdActive', async () => {
			getByIdActive.mockResolvedValue(GROUP);
			getUserRole.mockResolvedValue('admin');

			const ctx = await requireGroupRole({ id: 'group-1' }, 'admin');
			expect(ctx.group).toEqual(GROUP);
			expect(getByIdActive).toHaveBeenCalledWith('group-1');
			expect(getBySlug).not.toHaveBeenCalled();
		});

		it.each([
			['slug', { slug: 'no-such-group' }],
			['id', { id: 'no-such-group' }]
		])('404s an unresolvable %s ref', async (_name, ref) => {
			expect(await statusOf(() => requireGroupRole(ref, 'member'))).toBe(404);
			expect(getUserRole).not.toHaveBeenCalled();
		});

		it('404s a soft-deleted group, because the lookup filters it out', async () => {
			// `getBySlug` already excludes `deletedAt`; the guard inherits that
			// rather than re-checking, so the test pins the lookup's contract.
			getBySlug.mockResolvedValue(null);
			expect(await statusOf(() => requireGroupRole({ slug: 'deleted' }, 'member'))).toBe(404);
		});
	});

	/**
	 * Regression guard for JAVASCRIPT-SVELTEKIT-2T.
	 *
	 * That crash came from `params.slug` being absent on a raced navigation and
	 * `undefined` reaching D1, which answers `D1_TYPE_ERROR: Type 'undefined' not
	 * supported` — a 500 for what is really a 4xx. An explicit ref removes the
	 * cause, but a caller can still hand over a blank one, so the guard still has
	 * to answer it before any query is built.
	 */
	describe('with a blank ref', () => {
		beforeEach(() => {
			// What D1 actually does with an undefined bound parameter, rather than
			// the benign `null` the happy-path mock returns. Without this a missing
			// check reads as a tidy 404 and the test proves nothing.
			const rejectNonString = async (v: unknown) => {
				if (typeof v !== 'string') {
					throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
				}
				return null;
			};
			getBySlug.mockImplementation(rejectNonString);
			getByIdActive.mockImplementation(rejectNonString);
		});

		it.each([
			['empty slug', { slug: '' }],
			['whitespace slug', { slug: '   ' }],
			['undefined slug', { slug: undefined as unknown as string }],
			['empty id', { id: '' }],
			['undefined id', { id: undefined as unknown as string }]
		])('400s on an %s without reaching the database', async (_name, ref) => {
			expect(await statusOf(() => requireGroupRole(ref, 'member'))).toBe(400);
			expect(getBySlug).not.toHaveBeenCalled();
			expect(getByIdActive).not.toHaveBeenCalled();
			expect(getUserRole).not.toHaveBeenCalled();
		});
	});

	describe('the role floor', () => {
		beforeEach(() => getBySlug.mockResolvedValue(GROUP));

		it.each([
			['owner', 'owner', true],
			['owner', 'admin', true],
			['owner', 'member', true],
			['admin', 'owner', false],
			['admin', 'admin', true],
			['admin', 'member', true],
			['member', 'owner', false],
			['member', 'admin', false],
			['member', 'member', true]
		] as const)('a %s against a %s floor: %s', async (held, floor, allowed) => {
			getUserRole.mockResolvedValue(held);
			if (allowed) {
				await expect(requireGroupRole({ slug: 'our-band' }, floor)).resolves.toMatchObject({
					role: held
				});
			} else {
				expect(await statusOf(() => requireGroupRole({ slug: 'our-band' }, floor))).toBe(403);
			}
		});

		it('403s a non-member', async () => {
			getUserRole.mockResolvedValue(null);
			expect(await statusOf(() => requireGroupRole({ slug: 'our-band' }, 'member'))).toBe(403);
		});
	});

	describe('allowStaff', () => {
		beforeEach(() => {
			getBySlug.mockResolvedValue(GROUP);
			getUserRole.mockResolvedValue(null);
		});

		it('403s staff when it is not passed', async () => {
			hasAnyRole.mockResolvedValue(true);
			expect(await statusOf(() => requireGroupRole({ slug: 'our-band' }, 'member'))).toBe(403);
			expect(hasAnyRole).not.toHaveBeenCalled();
		});

		it("admits a staff non-member as role 'staff'", async () => {
			hasAnyRole.mockResolvedValue(true);
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true })
			).resolves.toMatchObject({ role: 'staff' });
			expect(hasAnyRole).toHaveBeenCalledWith('user-1', ['admin', 'staff']);
		});

		/**
		 * Passing `allowStaff` IS the decision that staff may do this thing, so it
		 * bypasses the floor rather than being ranked against it — otherwise the
		 * option would mean different things at different floors.
		 */
		it('bypasses the floor rather than ranking against it', async () => {
			hasAnyRole.mockResolvedValue(true);
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'owner', { allowStaff: true })
			).resolves.toMatchObject({ role: 'staff' });
		});

		it('403s a non-staff non-member even when it is passed', async () => {
			hasAnyRole.mockResolvedValue(false);
			expect(
				await statusOf(() => requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true }))
			).toBe(403);
		});

		/** A member's own role wins; staff status is never consulted for them. */
		it('does not consult staff status for an actual member', async () => {
			getUserRole.mockResolvedValue('member');
			await expect(
				requireGroupRole({ slug: 'our-band' }, 'member', { allowStaff: true })
			).resolves.toMatchObject({ role: 'member' });
			expect(hasAnyRole).not.toHaveBeenCalled();
		});
	});
});
