import { describe, expect, it } from 'vitest';

// A boundary with pending UI server-renders the spinner instead of what it wraps
// (ErrorToastBoundary.ssr.spec.ts). Around a layout's `children()` that is every
// page below it, which then paints only after its JavaScript, hydration and a
// second round trip for its queries (#3158). Pages may still opt in for their own.
const layouts = import.meta.glob<string>('./**/+layout.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
});

const boundaryTags = (source: string) => source.match(/<ErrorToastBoundary\b[^>]*>/g) ?? [];

describe('layout boundaries', () => {
	const withBoundary = Object.keys(layouts).filter((f) => boundaryTags(layouts[f]).length);

	it('finds the panel layouts', () => {
		expect(withBoundary).toEqual(
			expect.arrayContaining([
				'./member/+layout.svelte',
				'./staff/+layout.svelte',
				'./band/[slug]/+layout.svelte'
			])
		);
	});

	it.each(withBoundary)('%s server-renders what its boundary wraps', (file) => {
		for (const tag of boundaryTags(layouts[file])) {
			expect(tag).toContain('showPending={false}');
		}
	});
});
