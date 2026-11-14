import { describe, it, expect, vi, beforeEach } from 'vitest';

// Members shows each staffer the views their capabilities allow (#2074).
let held: string[] = [];
vi.mock('#lib/server/authorization.js', () => ({
	can: async (cap: string) => held.includes(cap)
}));

const all = await import('./+page.server');

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

	it('sends a volunteer.read-only staffer to the volunteer filter', async () => {
		held = ['volunteer.read'];
		await expect(run(all.load)).rejects.toMatchObject({
			status: 307,
			location: '/staff/members?role=volunteer'
		});
	});

	it('sends an instructor.read-only staffer to the teacher filter', async () => {
		held = ['instructor.read'];
		await expect(run(all.load)).rejects.toMatchObject({
			status: 307,
			location: '/staff/members?role=teacher'
		});
	});

	it('leaves a filtered view to its own remotes', async () => {
		held = ['volunteer.read'];
		await expect(
			run(all.load, undefined, 'http://x/staff/members?role=volunteer')
		).resolves.toBeUndefined();
	});

	it('leaves a signed-out visitor to the page', async () => {
		await expect(run(all.load, {})).resolves.toBeUndefined();
	});
});
