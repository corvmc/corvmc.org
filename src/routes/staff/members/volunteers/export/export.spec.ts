import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Capability, type Position } from '$lib/config';

/**
 * The volunteers roster CSV. A `+server.ts`, so its guard is not a remote
 * function's: this pins that it is the page's own `volunteer.read`, first.
 */

// Simulated against the real matrix, so the table exercises what positions grant.
let heldPositions: Position[] = ['staff'];
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('$lib/config');
	const holds = (cap: Capability) =>
		heldPositions.some((p) => config.grantsCapability(config.positions[p], cap));
	return {
		requireCapability: async (cap: Capability) => {
			if (!holds(cap)) throw error(403, 'Not permitted');
			return { id: 'staff-1' };
		}
	};
});

const listAllVolunteers = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('$lib/server/volunteer/volunteer-roster', async () => {
	const { z } = await import('zod');
	return {
		volunteerRosterFilters: z.object({
			q: z.string().optional(),
			role: z.string().optional(),
			status: z.string().optional(),
			cert: z.string().optional()
		}),
		listAllVolunteers: (...a: unknown[]) => listAllVolunteers(...a),
		volunteerRosterCsv: () => 'name\n'
	};
});

import { GET } from './+server';

const call = (query = '') =>
	GET({ url: new URL(`http://localhost/staff/members/volunteers/export${query}`) } as never);

const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
	positionOrder.filter((_, i) => mask & (1 << i))
);

beforeEach(() => {
	vi.clearAllMocks();
	heldPositions = ['staff'];
});

describe('the volunteers roster export', () => {
	it.each(subsets.map((s) => [s.join('+') || 'nobody', s] as const))(
		'answers %s exactly as volunteer.read does',
		async (_, positions) => {
			heldPositions = [...positions];
			const { grantsCapability, positions: matrix } = await import('$lib/config');
			const allowed = positions.some((p) => grantsCapability(matrix[p], 'volunteer.read'));

			if (allowed) {
				expect((await call()).status).toBe(200);
			} else {
				await expect(call()).rejects.toMatchObject({ status: 403 });
				expect(listAllVolunteers).not.toHaveBeenCalled();
			}
		}
	);

	it('exports the view on screen: the page URL keys are the filters', async () => {
		await call('?q=ada&role=r1&status=active&cert=c1&page=3');
		expect(listAllVolunteers).toHaveBeenCalledWith({
			q: 'ada',
			role: 'r1',
			status: 'active',
			cert: 'c1'
		});
	});

	it('downloads as a file', async () => {
		const res = await call();
		expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
	});
});
