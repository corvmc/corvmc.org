import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './ListDetailShell.test.svelte';

const pane = (name: 'list' | 'detail') => document.querySelector(`[data-pane="${name}"]`);

describe('ListDetailShell', () => {
	it('keeps the detail pane in panes mode with nothing open', async () => {
		await render(Harness, { open: false });
		expect(pane('list')).not.toBeNull();
		expect(pane('detail')).not.toBeNull();
	});

	it('gives the list the whole width in pages mode with nothing open', async () => {
		await render(Harness, { open: false, mode: 'pages' });
		expect(pane('list')).not.toBeNull();
		expect(pane('detail')).toBeNull();
		// The routed index page still renders, outside any pane.
		expect(document.querySelector('[data-testid="detail-body"]')).not.toBeNull();
	});

	it('puts the open record in a detail pane in pages mode', async () => {
		await render(Harness, { open: true, mode: 'pages' });
		expect(pane('list')).not.toBeNull();
		expect(pane('detail')?.querySelector('[data-testid="detail-body"]')).not.toBeNull();
	});
});
