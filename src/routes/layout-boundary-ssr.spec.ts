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

/** Sections not yet switched to server rendering. #3158 removes them one at a time. */
const CLIENT_RENDERED = ['./member/+layout.svelte', './band/[slug]/+layout.svelte'];

const boundaryTags = (source: string) => source.match(/<ErrorToastBoundary\b[^>]*>/g) ?? [];
const rendersSpinner = (source: string) =>
	boundaryTags(source).some((tag) => !tag.includes('showPending={false}')) ||
	/\{#snippet pending\(/.test(source) ||
	/<svelte:boundary\b[^>]*\bpending=/.test(source);

describe('layout boundaries', () => {
	it('finds the panel layouts', () => {
		expect(Object.keys(layouts)).toEqual(
			expect.arrayContaining(['./staff/+layout.svelte', ...CLIENT_RENDERED])
		);
		expect(boundaryTags(layouts['./staff/+layout.svelte'])).not.toHaveLength(0);
	});

	it.each(Object.keys(layouts).filter((f) => !CLIENT_RENDERED.includes(f)))(
		'%s server-renders what its boundary wraps',
		(file) => {
			expect(rendersSpinner(layouts[file])).toBe(false);
		}
	);

	// The list only shrinks: a section that renders on the server leaves it.
	it.each(CLIENT_RENDERED)('%s is still listed for a reason', (file) => {
		expect(rendersSpinner(layouts[file])).toBe(true);
	});
});
