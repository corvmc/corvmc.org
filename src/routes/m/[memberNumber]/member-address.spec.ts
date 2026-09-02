import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserByMemberNumber = vi.fn();
vi.mock('$lib/server/user/member-number-service', () => ({
	getUserByMemberNumber: (...a: unknown[]) => getUserByMemberNumber(...a)
}));

const isStaff = vi.fn(async () => false);
vi.mock('$lib/server/authorization', () => ({
	isStaff: (...a: unknown[]) => isStaff(...a)
}));

import { load } from './+page.server';

type Loaded = Parameters<typeof load>[0];

/**
 * `load` never returns — it redirects or errors — so every case is read off the
 * thrown object. `redirect()` and `error()` from @sveltejs/kit throw plain
 * objects carrying `status`, and `location` / `body` respectively.
 */
async function run(memberNumber: string, user: { id: string } | null = null) {
	try {
		await load({
			params: { memberNumber },
			locals: { user },
			// The Sentry vite plugin wraps every `load` export, and its proxy reads
			// the request and route off the event before calling through.
			route: { id: '/m/[memberNumber]' },
			url: new URL(`https://corvmc.org/m/${memberNumber}`),
			request: new Request(`https://corvmc.org/m/${memberNumber}`)
		} as unknown as Loaded);
	} catch (thrown) {
		return thrown as { status: number; location?: string; body?: { message: string } };
	}
	throw new Error('load returned instead of redirecting');
}

beforeEach(() => {
	getUserByMemberNumber.mockReset();
	isStaff.mockReset();
	isStaff.mockResolvedValue(false);
});

describe('/m/[memberNumber]', () => {
	it('sends a signed-out scan to the public profile', async () => {
		getUserByMemberNumber.mockResolvedValue({ id: 'u1', name: 'Jeff' });

		const result = await run('142');

		expect(result.status).toBe(302);
		expect(result.location).toBe('/directory/members/u1');
	});

	it('routes by viewer — a signed-in member lands in the panel they are in', async () => {
		getUserByMemberNumber.mockResolvedValue({ id: 'u1', name: 'Jeff' });

		const result = await run('142', { id: 'u2' });

		expect(result.location).toBe('/member/directory/members/u1');
	});

	it('sends a member scanning their own number to their own profile', async () => {
		getUserByMemberNumber.mockResolvedValue({ id: 'u1', name: 'Jeff' });

		const result = await run('142', { id: 'u1' });

		expect(result.location).toBe('/member/profile');
	});

	it('gives staff the operational record', async () => {
		getUserByMemberNumber.mockResolvedValue({ id: 'u1', name: 'Jeff' });
		isStaff.mockResolvedValue(true);

		const result = await run('142', { id: 'staff-1' });

		expect(result.location).toBe('/staff/users/u1');
	});

	it('404s on a number nobody holds', async () => {
		getUserByMemberNumber.mockResolvedValue(null);

		const result = await run('9999');

		expect(result.status).toBe(404);
		expect(result.body?.message).toBe('No member carries that number');
	});

	// Only digits resolve. `Number()` would take ' 12 ' and `parseInt` would take
	// '12abc', and neither is the address that was printed.
	it.each(['abc', '12abc', ' 12 ', '1.5', '-3', '0', '', '1e3'])(
		'404s on %o without ever reaching the database',
		async (raw) => {
			const result = await run(raw);

			expect(result.status).toBe(404);
			expect(getUserByMemberNumber).not.toHaveBeenCalled();
		}
	);
});
