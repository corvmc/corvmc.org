import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * `getRelatedTasks` (#2630) checks the record's own read guard, then the Tasks
 * table's `project.read`, before reading anything.
 */

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'usr-1' } }, url: new URL('http://x/') }),
		query: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'query'),
		form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw), {}), 'form'),
		command: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
			mark(async (raw: unknown) => handler(schema.parse(raw)), 'command')
	};
});
vi.mock('#lib/server/db/index.js', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('./projects.remote', () => ({ getProjectActivity: vi.fn(), getProjectDetail: vi.fn() }));

let granted = new Set<string>();
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => ({ id: 'usr-1' }),
		can: async (cap: string) => granted.has(cap),
		requireCapability: async (cap: string) => {
			if (!granted.has(cap)) error(403, 'Not permitted');
			return { id: 'usr-1' };
		}
	};
});
const requireListingReader = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/event/listing-guard.js', () => ({ requireListingReader }));
const requireOrganizationReader = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/party/organization-guard.js', () => ({ requireOrganizationReader }));
const relatedTasks = vi.hoisted(() => vi.fn());
const newTaskPrefill = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/task/related-tasks.js', () => ({
	relatedTasks,
	newTaskPrefill,
	relatedTaskWhere: vi.fn()
}));
const listJobs = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/contractor/contractor-job-service.js', () => ({ listJobs }));

const { getRelatedTasks } = (await import('./tasks.remote')) as unknown as {
	getRelatedTasks: (raw: unknown) => Promise<Record<string, unknown> | null>;
};

beforeEach(() => {
	granted = new Set();
	requireListingReader.mockReset();
	relatedTasks.mockReset().mockResolvedValue([{ key: 'group', tasks: [{ id: 'wo-1' }] }]);
	newTaskPrefill.mockReset().mockResolvedValue({ groupId: 'g1' });
	listJobs.mockReset().mockResolvedValue([]);
});

describe('getRelatedTasks', () => {
	it("refuses without the record's own read capability", async () => {
		granted = new Set(['project.read']);
		await expect(getRelatedTasks({ type: 'group', id: 'g1' })).rejects.toMatchObject({
			status: 403
		});
		expect(relatedTasks).not.toHaveBeenCalled();
	});

	it('reads nothing for a record reader without project.read', async () => {
		granted = new Set(['group.read']);
		expect(await getRelatedTasks({ type: 'group', id: 'g1' })).toBeNull();
		expect(relatedTasks).not.toHaveBeenCalled();
	});

	it("guards an event with the listing's reader check", async () => {
		granted = new Set(['project.read']);
		await getRelatedTasks({ type: 'event', id: 'e1' });
		expect(requireListingReader).toHaveBeenCalledWith('e1');
	});

	it('marks engagements on the related tasks only with contractor.read', async () => {
		granted = new Set(['group.read', 'project.read']);
		await getRelatedTasks({ type: 'group', id: 'g1' });
		expect(listJobs).not.toHaveBeenCalled();

		granted.add('contractor.read');
		const page = await getRelatedTasks({ type: 'group', id: 'g1', includeDone: true });
		expect(relatedTasks).toHaveBeenLastCalledWith(
			{ type: 'group', id: 'g1' },
			{ includeDone: true }
		);
		expect(listJobs).toHaveBeenCalledWith({ workOrderIds: ['wo-1'], view: 'open' });
		expect(page?.prefill).toEqual({ groupId: 'g1' });
	});

	it("guards an organization with its page's reader check (#2622)", async () => {
		granted = new Set(['project.read']);
		await getRelatedTasks({ type: 'organization', id: 'o1' });
		expect(requireOrganizationReader).toHaveBeenCalledWith('o1');
	});

	it("guards a unit, a booking and a person with each one's read capability", async () => {
		granted = new Set(['project.read']);
		for (const type of ['asset', 'reservation', 'contact']) {
			await expect(getRelatedTasks({ type, id: 'x' })).rejects.toMatchObject({ status: 403 });
		}
		granted = new Set(['project.read', 'inventory.read', 'reservation.read', 'contact.read']);
		for (const type of ['asset', 'reservation', 'contact']) {
			await expect(getRelatedTasks({ type, id: 'x' })).resolves.not.toBeNull();
		}
	});

	it('refuses a subject type it does not know', async () => {
		granted = new Set(['project.read']);
		await expect(getRelatedTasks({ type: 'nonsense', id: 'x' })).rejects.toThrow();
	});
});
