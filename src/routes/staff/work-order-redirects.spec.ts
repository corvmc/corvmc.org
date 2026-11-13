import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectsTarget } from './projects/projects-target';

/**
 * Every old address of a task, a project or a jobs list lands on its Tasks
 * page in one hop (#2625). None may loop: no target is itself redirected.
 */

const getJobById = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/contractor/contractor-job-service.js', () => ({ getJobById }));
let permitted = true;
vi.mock('#lib/server/authorization.js', () => ({ can: async () => permitted }));

const shift = await import('./volunteer/shifts/[id]/+page');
const schedule = await import('./volunteer/schedule/+page');
const volunteerIndex = await import('./volunteer/+page');
const shiftsIndex = await import('./volunteer/shifts/+page');
const job = await import('./contractors/jobs/[id]/+page.server');
const list = await import('./contractors/jobs/+page');

const signedIn = { user: { id: 'usr-1' } };
type Load = (e: unknown) => Promise<unknown>;
// The build wraps each load in Sentry's, which reads the request and route off the event.
const run = (load: unknown, id: string, search = '', locals: object = signedIn) =>
	(async () =>
		(load as Load)({
			params: { id },
			locals,
			url: new URL(`http://x/staff/x/${id}${search}`),
			route: { id: '/staff/x/[id]' },
			request: new Request(`http://x/staff/x/${id}${search}`)
		}))();

beforeEach(() => {
	permitted = true;
	getJobById.mockReset();
});

describe('/staff/projects/*', () => {
	it.each([
		['', '', '/staff/tasks?group=project'],
		['productions', '?status=draft', '/staff/tasks/productions?status=draft'],
		['templates', '', '/staff/tasks/templates'],
		['templates/t1', '', '/staff/tasks/templates/t1'],
		['p1', '?task=wo-1', '/staff/tasks/projects/p1?task=wo-1'],
		['p1/budget', '', '/staff/tasks/projects/p1/budget'],
		['p1/tasks/wo-1', '', '/staff/tasks/wo-1']
	])('/staff/projects/%s%s', (rest, search, target) => {
		expect(projectsTarget(rest, search)).toBe(target);
	});
});

describe('/staff/volunteer/shifts/[id]', () => {
	it('sends every work order to its task page, whatever project it is in', async () => {
		await expect(run(shift.load, 'wo-1')).rejects.toMatchObject({
			status: 308,
			location: '/staff/tasks/wo-1'
		});
	});
});

describe('/staff/volunteer/schedule', () => {
	it('sends work with no shift and contractor work to Tasks', async () => {
		await expect(run(schedule.load, '', '?kind=untimed')).rejects.toMatchObject({
			location: '/staff/tasks?kind=untimed'
		});
		await expect(
			run(schedule.load, '', '?kind=contractor&contractor=awaiting-invoice')
		).rejects.toMatchObject({ location: '/staff/tasks?kind=contractor&chip=invoice' });
	});

	it("sends the unassigned queue to Tasks' chip", async () => {
		await expect(run(schedule.load, '', '?needs=unassigned')).rejects.toMatchObject({
			location: '/staff/tasks?chip=unassigned'
		});
	});

	it('sends shifts to Volunteering, keeping the window, role and queue', async () => {
		await expect(run(schedule.load, '')).rejects.toMatchObject({
			status: 308,
			location: '/staff/volunteering'
		});
		await expect(
			run(schedule.load, '', '?days=30&role=door&needs=short&kind=timed&project=none')
		).rejects.toMatchObject({ location: '/staff/volunteering?days=30&role=door&needs=short' });
	});
});

describe('/staff/volunteer and /staff/volunteer/shifts', () => {
	it('land on Volunteering', async () => {
		for (const load of [volunteerIndex.load, shiftsIndex.load]) {
			await expect(run(load, '')).rejects.toMatchObject({
				status: 308,
				location: '/staff/volunteering'
			});
		}
	});
});

describe('/staff/contractors/jobs/[id]', () => {
	it("sends an engagement to its task's page, at its card", async () => {
		getJobById.mockResolvedValue({ id: 'cj-1', workOrderId: 'wo-1', projectId: 'proj-1' });
		await expect(run(job.load, 'cj-1')).rejects.toMatchObject({
			location: '/staff/tasks/wo-1#engagement-cj-1'
		});
	});

	it('reveals nothing to a caller without contractor.read', async () => {
		permitted = false;
		await expect(run(job.load, 'cj-1')).rejects.toMatchObject({ status: 403 });
		expect(getJobById).not.toHaveBeenCalled();
	});
});

describe('/staff/contractors/jobs', () => {
	it("is the Tasks table's contractor filter, keeping the invoice view", async () => {
		await expect(run(list.load, '')).rejects.toMatchObject({
			status: 308,
			location: '/staff/tasks?kind=contractor'
		});
		await expect(run(list.load, '', '?view=awaiting-invoice')).rejects.toMatchObject({
			location: '/staff/tasks?kind=contractor&chip=invoice'
		});
	});
});
