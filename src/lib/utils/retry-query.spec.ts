import { describe, it, expect, vi } from 'vitest';
import { retryQuery } from './retry-query';

describe('retryQuery', () => {
	it('re-requests before re-rendering, so the boundary does not read the cached rejection', async () => {
		const order: string[] = [];
		const query = { refresh: vi.fn(async () => void order.push('refresh')) };
		await retryQuery(query, () => order.push('reset'));
		expect(order).toEqual(['refresh', 'reset']);
	});

	it('still resets when the refresh rejects, so the boundary can show the new failure', async () => {
		const reset = vi.fn();
		await retryQuery({ refresh: () => Promise.reject(new Error('down')) }, reset);
		expect(reset).toHaveBeenCalledOnce();
	});
});
