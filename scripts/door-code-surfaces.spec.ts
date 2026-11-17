import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A reservation's door code is rendered only by `DoorCode.svelte`, which reads
 * the lock's window from `doorCodeWindow` and says when the code starts
 * working (#3173). Digits printed anywhere else are a code the lock may still
 * reject, with nothing next to them saying so.
 */
const RENDERER = 'src/lib/components/reservations/DoorCode.svelte';

/** Code shown outside a reservation's window, so with no window to state. */
const ALLOWED = new Set([
	RENDERER,
	// The break-glass code's health panel, for staff: not tied to a booking.
	'src/routes/staff/reservations/settings/building-access/LockHealth.svelte'
]);

// A mustache that prints a code, or a message input that carries one. Block
// tags (`{#if res.lockCode}`) only test for it; an attribute (`code={…}`) hands
// it to a component, which this same scan covers.
const PRINTS_CODE =
	/(?<!=)\{(?![#/:@])[^{}]*\b(?:lockCode|fallbackCode)\s*\}|\b(?:lockCode|fallbackCode):/g;

function offenders(file: string): string[] {
	const source = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (c) =>
		c.replace(/[^\n]/g, ' ')
	);
	return [...source.matchAll(PRINTS_CODE)].map(
		(hit) => `${file}:${source.slice(0, hit.index).split('\n').length}`
	);
}

describe('door code surfaces', () => {
	it('render a code only through DoorCode', () => {
		expect(sourceFiles(['src/**/*.svelte'], ALLOWED).flatMap(offenders)).toEqual([]);
	});
});
