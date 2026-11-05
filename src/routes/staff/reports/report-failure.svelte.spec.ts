import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Component } from 'svelte';
import OuterBoundary from '$lib/components/ui/OuterBoundary.test.svelte';
import Annual from './annual/+page.svelte';
import Volunteering from './volunteering/+page.svelte';
import InventorySpend from './inventory-spend/+page.svelte';
import Acquisitions from './acquisitions/+page.svelte';

// A query that refuses, shaped like a remote: thenable, with `refresh`.
const refused = vi.hoisted(() => () => {
	const rejection = Promise.reject(new Error('Not permitted'));
	rejection.catch(() => {});
	return Object.assign(rejection, { refresh: () => Promise.resolve() });
});

vi.mock('$lib/remote/reports.remote', () => ({ getAnnualReportPage: refused }));
vi.mock('$lib/remote/volunteer.remote', () => ({ getVolunteerReportPage: refused }));
vi.mock('$lib/remote/inventory.remote', () => ({
	getSpendReport: refused,
	getAcquisitions: refused
}));
vi.mock('$lib/remote/layout.remote', () => ({
	getStaffLayout: () => Promise.resolve({ capabilities: [] })
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// Each tab has to reach the panel layout's boundary: that is what tells a viewer
// the report did not load, and a rejection nothing handles renders as nothing.
describe('a report tab whose query fails', () => {
	it.each([
		['annual', Annual],
		['volunteering', Volunteering],
		['inventory-spend', InventorySpend],
		['acquisitions', Acquisitions]
	])('%s reaches the panel boundary', async (_tab, page) => {
		const inner = page as unknown as Component<Record<string, unknown>>;
		const { container } = await render(OuterBoundary, { inner, innerProps: {} });

		await vi.waitFor(() => expect(container.querySelector('[data-outer-failed]')).not.toBeNull());
	});
});
