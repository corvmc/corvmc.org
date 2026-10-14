import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The old shift and job addresses send a project's work order to its task
 * page, and leave work on no project where it was. Neither may loop: the shift
 * page only redirects away from itself, and the task page never redirects.
 */

const workOrderProjectId = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/volunteer/work-order-service', () => ({ workOrderProjectId }));
const getJobById = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/contractor/contractor-job-service', () => ({ getJobById }));
let permitted = true;
vi.mock('$lib/server/authorization', () => ({ can: async () => permitted }));

const shift = await import('./volunteer/shifts/[id]/+page.server');
const job = await import('./contractors/jobs/[id]/+page.server');

const signedIn = { user: { id: 'usr-1' } };
type Load = (e: unknown) => Promise<unknown>;
// The build wraps each load in Sentry's, which reads the request and route off the event.
const run = (load: unknown, id: string, locals: object = signedIn) =>
	(load as Load)({
		params: { id },
		locals,
		url: new URL(`http://x/staff/x/${id}`),
		route: { id: '/staff/x/[id]' },
		request: new Request(`http://x/staff/x/${id}`)
	});

beforeEach(() => {
	permitted = true;
	workOrderProjectId.mockReset();
	getJobById.mockReset();
});

describe('/staff/volunteer/shifts/[id]', () => {
	it('redirects a project work order to its task page', async () => {
		workOrderProjectId.mockResolvedValue('proj-1');
		await expect(run(shift.load, 'wo-1')).rejects.toMatchObject({
			status: 307,
			location: '/staff/projects/proj-1/tasks/wo-1'
		});
	});

	it('renders work on no project, and an unknown id, in place', async () => {
		workOrderProjectId.mockResolvedValue(null);
		await expect(run(shift.load, 'wo-1')).resolves.toBeUndefined();
		workOrderProjectId.mockResolvedValue(undefined);
		await expect(run(shift.load, 'nope')).resolves.toBeUndefined();
	});

	it('leaves a signed-out visitor to the page, which asks them to sign in', async () => {
		await expect(run(shift.load, 'wo-1', {})).resolves.toBeUndefined();
		expect(workOrderProjectId).not.toHaveBeenCalled();
	});
});

describe('/staff/contractors/jobs/[id]', () => {
	it("sends an engagement to its work order's canonical page, at its card", async () => {
		getJobById.mockResolvedValue({ id: 'cj-1', workOrderId: 'wo-1', projectId: 'proj-1' });
		await expect(run(job.load, 'cj-1')).rejects.toMatchObject({
			location: '/staff/projects/proj-1/tasks/wo-1#engagement-cj-1'
		});
		getJobById.mockResolvedValue({ id: 'cj-2', workOrderId: 'wo-2', projectId: null });
		await expect(run(job.load, 'cj-2')).rejects.toMatchObject({
			location: '/staff/volunteer/shifts/wo-2#engagement-cj-2'
		});
	});

	it('reveals nothing to a caller without contractor.read', async () => {
		permitted = false;
		await expect(run(job.load, 'cj-1')).rejects.toMatchObject({ status: 403 });
		expect(getJobById).not.toHaveBeenCalled();
	});
});
