import { describe, it, expect, vi, beforeEach } from 'vitest';

let selectResultQueue: unknown[][] = [];
const updatedValues: Record<string, unknown>[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResultQueue.length > 0 ? selectResultQueue.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		update: vi.fn(() => ({
			set: vi.fn((v: Record<string, unknown>) => {
				updatedValues.push(v);
				return { where: vi.fn(() => Promise.resolve([])) };
			})
		})),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{}])) })),
				returning: vi.fn(() => Promise.resolve([{}]))
			}))
		})),
		delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))
	}
}));

vi.mock('./stock-service', () => ({
	recordMovement: vi.fn().mockResolvedValue({ id: 'mv-1' })
}));

vi.mock('./asset-flag-service', () => ({
	raiseFlag: vi.fn().mockResolvedValue({ id: 'flag-1', assetId: 'as-1' })
}));

vi.mock('$lib/server/media/media-service', () => ({ listFor: vi.fn().mockResolvedValue([]) }));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string) => `https://cdn/${k}` }));

import { reportDamage } from './resources-service';
import { recordMovement } from './stock-service';
import { raiseFlag } from './asset-flag-service';

beforeEach(() => {
	vi.clearAllMocks();
	selectResultQueue = [];
	updatedValues.length = 0;
	vi.mocked(recordMovement).mockResolvedValue({ id: 'mv-1' } as never);
});

/**
 * `reportDamage` is now a thin wrapper over `raiseFlag` — the behaviour it used
 * to own (the status change, the movement, the refusals) moved to
 * `asset-flag-service`, and is tested there against the real logic rather than
 * re-asserted through a delegation.
 *
 * What is worth pinning here is the default, because it is the compatibility
 * seam: every caller that has not been taught to ask "is it still usable?"
 * must keep the old immediate-pull behaviour.
 */
describe('reportDamage', () => {
	it('defaults to blocking, so an unasked report still pulls the unit', async () => {
		await reportDamage({ assetId: 'as-1', note: 'x', reportedByUserId: 'u' });

		expect(raiseFlag).toHaveBeenCalledWith(expect.objectContaining({ blocksUse: true }));
	});

	it('passes through a reporter who said it is still usable', async () => {
		await reportDamage({
			assetId: 'as-1',
			note: 'Tolex torn',
			reportedByUserId: 'u',
			blocksUse: false
		});

		expect(raiseFlag).toHaveBeenCalledWith(expect.objectContaining({ blocksUse: false }));
	});

	it('carries the note, the reporter and the condition', async () => {
		await reportDamage({
			assetId: 'as-1',
			note: 'Crackling on channel two',
			reportedByUserId: 'user-9',
			condition: 'poor'
		});

		expect(raiseFlag).toHaveBeenCalledWith(
			expect.objectContaining({
				assetId: 'as-1',
				note: 'Crackling on channel two',
				reportedByUserId: 'user-9',
				condition: 'poor'
			})
		);
	});
});
