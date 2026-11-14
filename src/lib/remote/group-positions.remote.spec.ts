import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// Who may name and fill a committee's positions (#2988): its chair, or
// `group.manage`. The committee is the guard's resolved one, never the client's.

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

const { createCommitteePosition, updateCommitteePosition, deleteCommitteePosition } =
	await import('./group-positions.remote');

beforeEach(() => {
	vi.clearAllMocks();
	guard.requireProgramRole.mockResolvedValue({
		user: { id: 'u-chair' },
		group: { id: 'g-resolved', kind: 'committee' },
		role: 'admin'
	});
});

describe('committee position remotes', () => {
	it('each names the chair role and admits group.manage', async () => {
		await createCommitteePosition({ slug: 'booking', name: 'Treasurer' } as never);
		await updateCommitteePosition({
			slug: 'booking',
			positionId: 'p-1',
			name: 'Treasurer',
			memberIds: ['m-1']
		} as never);
		await deleteCommitteePosition({ slug: 'booking', positionId: 'p-1' } as never);

		expect(guard.requireProgramRole.mock.calls).toEqual(
			Array(3).fill([{ slug: 'booking' }, 'admin', { staff: 'group.manage' }])
		);
	});

	it('writes to the resolved committee', async () => {
		await updateCommitteePosition({
			slug: 'booking',
			positionId: 'p-1',
			name: 'Treasurer',
			memberIds: ['m-1']
		} as never);
		expect(svc.renamePosition).toHaveBeenCalledWith('g-resolved', 'p-1', 'Treasurer');
		expect(svc.setHolders).toHaveBeenCalledWith('g-resolved', 'p-1', ['m-1'], 'u-chair');
	});

	it('writes nothing for a caller the guard refuses', async () => {
		guard.requireProgramRole.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
		await expect(
			deleteCommitteePosition({ slug: 'booking', positionId: 'p-1' } as never)
		).rejects.toThrow();
		expect(svc.deletePosition).not.toHaveBeenCalled();
	});
});
