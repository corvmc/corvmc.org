import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tasks shows each staffer the views their capabilities allow (#2101, #2625).
let held: string[] = [];
vi.mock('#lib/server/authorization.js', () => ({
	can: async (cap: string) => held.includes(cap)
}));

const tasks = await import('./+page.server');
const productions = await import('../productions/+page');
const { visibleViews } = await import('../views');
const { taskViews } = await import('./views');

type Load = (e: unknown) => unknown;
const run = async (load: unknown, locals: object = { user: { id: 'usr-1' } }, url = 'http://x/') =>
	(load as Load)({
		locals,
		url: new URL(url),
		params: {},
		route: { id: '/staff/tasks' },
		request: new Request(url)
	});

beforeEach(() => {
	held = [];
});

describe('/staff/tasks', () => {
	it('shows Tasks to a project.read holder', async () => {
		held = ['project.read', 'event.manage'];
		await expect(run(tasks.load)).resolves.toBeUndefined();
	});

	it('sends an event.manage-only staffer to Productions', async () => {
		held = ['event.manage'];
		await expect(run(tasks.load)).rejects.toMatchObject({
			status: 307,
			location: '/staff/tasks/productions'
		});
	});
});

describe('tabs', () => {
	it.each([
		[
			['project.read', 'event.manage', 'volunteer.read'],
			['tasks', 'projects', 'productions']
		],
		[['project.read'], ['tasks', 'projects']],
		[['event.manage'], ['productions']]
	])('holding %j shows %j', (caps, keys) => {
		expect(visibleViews(taskViews, caps).map((v) => v.key)).toEqual(keys);
	});
});

describe('/staff/productions', () => {
	it('lands on the Productions view with its filters', async () => {
		await expect(
			run(productions.load, {}, 'http://x/staff/productions?status=draft&needs=1')
		).rejects.toMatchObject({
			status: 308,
			location: '/staff/tasks/productions?status=draft&needs=1'
		});
	});
});
