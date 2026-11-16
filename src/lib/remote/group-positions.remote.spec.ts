import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// Who may name and fill a committee's positions (#2988): its chair, or
// `committee.manage` (#3009). The committee is the guard's resolved one, never the client's.

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'u-chair' } }, url: new URL('http://x/') }),
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } }),
	command: vi.fn()
}));

const guard = vi.hoisted(() => ({ requireProgramRole: vi.fn() }));
vi.mock('#lib/server/group/group-context.js', () => guard);

const svc = vi.hoisted(() => ({
	POSITION_NAME_MAX: 60,
	createPosition: vi.fn(async () => ({ id: 'p-1' })),
	renamePosition: vi.fn(),
	setHolders: vi.fn(),
	deletePosition: vi.fn()
}));
vi.mock('#lib/server/group/position-service.js', () => svc);

// The `$app/server` mock above makes each form a plain async function.
type Call = (data: unknown) => Promise<unknown>;
const { createCommitteePosition, updateCommitteePosition, deleteCommitteePosition } =
	(await import('./group-positions.remote')) as unknown as Record<string, Call>;

beforeEach(() => {
	vi.clearAllMocks();
	guard.requireProgramRole.mockResolvedValue({
		user: { id: 'u-chair' },
		group: { id: 'g-resolved', kind: 'committee' },
		role: 'admin'
	});
});

describe('committee position remotes', () => {
	it('each names the chair role and admits committee.manage', async () => {
		await createCommitteePosition({ slug: 'booking', name: 'Treasurer' });
		await updateCommitteePosition({
			slug: 'booking',
			positionId: 'p-1',
			name: 'Treasurer',
			memberIds: ['m-1']
		});
		await deleteCommitteePosition({ slug: 'booking', positionId: 'p-1' });

		expect(guard.requireProgramRole.mock.calls).toEqual(
			Array(3).fill([{ slug: 'booking' }, 'admin', { staff: 'committee.manage' }])
		);
	});

	it('writes to the resolved committee', async () => {
		await updateCommitteePosition({
			slug: 'booking',
			positionId: 'p-1',
			name: 'Treasurer',
			memberIds: ['m-1']
		});
		expect(svc.renamePosition).toHaveBeenCalledWith('g-resolved', 'p-1', 'Treasurer');
		expect(svc.setHolders).toHaveBeenCalledWith('g-resolved', 'p-1', ['m-1'], 'u-chair');
	});

	it('writes nothing for a caller the guard refuses', async () => {
		guard.requireProgramRole.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
		await expect(deleteCommitteePosition({ slug: 'booking', positionId: 'p-1' })).rejects.toThrow();
		expect(svc.deletePosition).not.toHaveBeenCalled();
	});
});
