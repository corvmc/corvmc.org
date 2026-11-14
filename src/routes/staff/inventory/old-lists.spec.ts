import { describe, it, expect } from 'vitest';

/** Restock was a list page until #2021; bookmarks land on the list's view. */

const restock = await import('./restock/+page');

type Load = (e: unknown) => unknown;
// The build wraps each load in Sentry's, which reads the URL and route off the event.
const run = async (load: unknown, path: string) =>
	(load as Load)({ params: {}, url: new URL(`http://x${path}`), route: { id: path } });

describe('retired Inventory lists, now Supplies views', () => {
	it('forwards Restock to the reorder-point view', async () => {
		await expect(run(restock.load, '/staff/inventory/restock')).rejects.toMatchObject({
			status: 308,
			location: '/staff/inventory/supplies?show=restock'
		});
	});
});
