import { describe, it, expect } from 'vitest';
import { filters, seedFromUrl, applySaved, toSearch } from './filters.svelte';

/**
 * The one place a retired view name is still allowed to appear.
 *
 * `awaiting` was a tab of its own until Snoozed absorbed it, and there is no
 * migration rewriting the `inbox_saved_view.filters` rows that stored it — so
 * both ways in have to map it rather than fall back to Open, which would be a
 * different queue from the one somebody saved.
 */
describe('parseView, through its two callers', () => {
	it('maps the retired awaiting view onto Snoozed', () => {
		seedFromUrl(new URLSearchParams('view=awaiting'));
		expect(filters.view).toBe('snoozed');

		seedFromUrl(new URLSearchParams());
		applySaved({ view: 'awaiting' });
		expect(filters.view).toBe('snoozed');
	});

	// And the URL tidies itself up: the mirroring effect in InboxList writes
	// whatever the filters hold, so an old link becomes a current one in place.
	it('serialises back as the view it mapped to', () => {
		seedFromUrl(new URLSearchParams('view=awaiting'));
		expect(toSearch()).toBe('view=snoozed');
	});

	it('falls back to Open for a word that was never a view', () => {
		seedFromUrl(new URLSearchParams('view=parked'));
		expect(filters.view).toBe('open');
	});

	it('keeps a view that still exists', () => {
		seedFromUrl(new URLSearchParams('view=resolved'));
		expect(filters.view).toBe('resolved');
	});
});
