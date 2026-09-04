import { describe, it, expect } from 'vitest';
import { snoozePresets } from './snooze-presets';

/**
 * The bug this pins took the snooze menu out entirely, every Friday and every
 * Sunday, and did not look like a date bug from the outside: the trigger read
 * `data-state="open" aria-expanded="true"` and `<body>` held no menu, because
 * `each_key_duplicate` was thrown while the portal's content rendered. It was
 * invisible to a suite run on any other weekday, which is why every local run
 * passed and CI went red the moment UTC rolled into a Friday.
 */
const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe('snoozePresets', () => {
	// A weekday where every horizon is distinct: +1 Fri, +3 Sun, Monday +4.
	it('offers all four horizons on a Thursday', () => {
		expect(snoozePresets(at('2026-09-03')).map((p) => p.label)).toEqual([
			'Tomorrow',
			'Later this week',
			'Next week',
			'In two weeks'
		]);
	});

	// `nextMonday` is three days out, so "Next week" *is* "Later this week".
	it('drops the duplicate on a Friday', () => {
		const presets = snoozePresets(at('2026-09-04'));

		expect(presets.map((p) => p.value)).toEqual(['2026-09-05', '2026-09-07', '2026-09-18']);
		expect(presets.map((p) => p.label)).toEqual(['Tomorrow', 'Later this week', 'In two weeks']);
	});

	// `nextMonday` is one day out, so "Next week" *is* "Tomorrow" — and the
	// nearer label is the one worth keeping.
	it('drops the duplicate on a Sunday', () => {
		const presets = snoozePresets(at('2026-09-06'));

		expect(presets.map((p) => p.value)).toEqual(['2026-09-07', '2026-09-09', '2026-09-20']);
		expect(presets.map((p) => p.label)).toEqual(['Tomorrow', 'Later this week', 'In two weeks']);
	});

	// The invariant the `{#each}` key depends on, asserted across a whole week so
	// a fifth preset cannot reintroduce the collision on a day nobody tested.
	it('never repeats a date, on any day of the week', () => {
		for (const day of ['06', '07', '08', '09', '10', '11', '12']) {
			const values = snoozePresets(at(`2026-09-${day}`)).map((p) => p.value);

			expect(new Set(values).size, `duplicate snooze date on 2026-09-${day}`).toBe(values.length);
		}
	});
});
