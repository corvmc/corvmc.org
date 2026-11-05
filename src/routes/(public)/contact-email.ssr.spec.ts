import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('#lib/remote/settings.remote.js', () => ({
	getContactEmail: () => Promise.resolve('desk@example.org')
}));

// A glob because no type declaration covers a `.md` import. Eager, because an in-test import
// pays the module-graph cost inside the test timeout.
const markdown = import.meta.glob<{ default: Component }>('./about/{privacy,bylaws}/+page.md', {
	eager: true
});
const pages: Record<string, Component> = {
	privacy: markdown['./about/privacy/+page.md'].default,
	bylaws: markdown['./about/bylaws/+page.md'].default,
	'gear donation note': (await import('./programs/GearDonationNote.svelte')).default
};

function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
}

describe('the public contact address', () => {
	it.each(Object.entries(pages))('%s server-renders the setting', async (_name, Page) => {
		const { body } = await render(Page);

		expect(body).toContain('href="mailto:desk@example.org"');
	});

	// Built from parts so this file does not match its own search.
	it('the old address appears nowhere in the public routes or messages', () => {
		const old = ['info', 'corvmc.org'].join('@');
		const files = [...filesUnder('src/routes/(public)'), ...filesUnder('messages')];

		expect(files.length).toBeGreaterThan(0);
		expect(files.filter((path) => readFileSync(path, 'utf8').includes(old))).toEqual([]);
	});
});
