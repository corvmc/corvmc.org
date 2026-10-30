import { describe, it, expect, vi, beforeEach } from 'vitest';

// Members shows each staffer the views their capabilities allow (#2074).
let held: string[] = [];
vi.mock('$lib/server/authorization', () => ({
	can: async (cap: string) => held.includes(cap)
}));

const all = await import('./+page.server');
const people = await import('../volunteer/people/+page');

type Load = (e: unknown) => unknown;
const run = async (load: unknown, locals: object = { user: { id: 'usr-1' } }, url = 'http://x/') =>
	(load as Load)({
		locals,
		url: new URL(url),
		params: {},
		route: { id: '/staff/members' },
		request: new Request(url)
	});

beforeEach(() => {
	held = [];
});

describe('/staff/members', () => {
	it('shows All to a user.list holder', async () => {
		held = ['user.list', 'volunteer.read'];
		await expect(run(all.load)).resolves.toBeUndefined();
	});

	it('sends a volunteer.read-only staffer to Volunteers', async () => {
		held = ['volunteer.read'];
		await expect(run(all.load)).rejects.toMatchObject({
			status: 307,
			location: '/staff/members/volunteers'
		});
	});

	it('sends an instructor.read-only staffer to Instructors', async () => {
		held = ['instructor.read'];
		await expect(run(all.load)).rejects.toMatchObject({
			status: 307,
			location: '/staff/members/instructors'
		});
	});

	it('leaves a signed-out visitor to the page', async () => {
		await expect(run(all.load, {})).resolves.toBeUndefined();
	});
});

describe('/staff/volunteer/people', () => {
	it('keeps the retired sign-off tab as the blocked filter', async () => {
		await expect(
			run(people.load, {}, 'http://x/staff/volunteer/people?tab=signoff&q=a')
		).rejects.toMatchObject({
			status: 308,
			location: '/staff/members/volunteers?q=a&status=blocked'
		});
	});
});
