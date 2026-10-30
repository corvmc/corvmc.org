import { describe, it, expect, vi, beforeEach } from 'vitest';

// Projects shows each staffer the views their capabilities allow (#2101).
let held: string[] = [];
vi.mock('$lib/server/authorization', () => ({
	can: async (cap: string) => held.includes(cap)
}));

const projects = await import('./+page.server');
const productions = await import('../productions/+page');

type Load = (e: unknown) => unknown;
const run = async (load: unknown, locals: object = { user: { id: 'usr-1' } }, url = 'http://x/') =>
	(load as Load)({
		locals,
		url: new URL(url),
		params: {},
		route: { id: '/staff/projects' },
		request: new Request(url)
	});

beforeEach(() => {
	held = [];
});

describe('/staff/projects', () => {
	it('shows Projects to a project.read holder', async () => {
		held = ['project.read', 'event.manage'];
		await expect(run(projects.load)).resolves.toBeUndefined();
	});

	it('sends an event.manage-only staffer to Productions', async () => {
		held = ['event.manage'];
		await expect(run(projects.load)).rejects.toMatchObject({
			status: 307,
			location: '/staff/projects/productions'
		});
	});
});

describe('/staff/productions', () => {
	it('lands on the Productions view with its filters', async () => {
		await expect(
			run(productions.load, {}, 'http://x/staff/productions?status=draft&needs=1')
		).rejects.toMatchObject({
			status: 308,
			location: '/staff/projects/productions?status=draft&needs=1'
		});
	});
});
