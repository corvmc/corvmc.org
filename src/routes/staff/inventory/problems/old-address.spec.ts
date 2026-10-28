import { describe, it, expect } from 'vitest';

/**
 * Reported problems lived on the moderation surface at `/staff/flags/equipment`
 * (#552) until #1840. Bookmarks still carry that address, so it forwards to the
 * queue's own, keeping the report id.
 */

const queue = await import('../../flags/equipment/+page');
const report = await import('../../flags/equipment/[id]/+page');

type Load = (e: unknown) => unknown;
// The build wraps each load in Sentry's, which reads the URL and route off the event.
const run = async (load: unknown, path: string, params: object = {}) =>
	(load as Load)({ params, url: new URL(`http://x${path}`), route: { id: path } });

describe('/staff/flags/equipment', () => {
	it('forwards the queue', async () => {
		await expect(run(queue.load, '/staff/flags/equipment')).rejects.toMatchObject({
			status: 308,
			location: '/staff/inventory/problems'
		});
	});

	it('forwards a report, keeping its id', async () => {
		await expect(
			run(report.load, '/staff/flags/equipment/wr-1', { id: 'wr-1' })
		).rejects.toMatchObject({ status: 308, location: '/staff/inventory/problems/wr-1' });
	});
});
