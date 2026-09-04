import { addDays, format, nextMonday } from 'date-fns';
import { formatDate } from '$lib/utils/format';

export type SnoozePreset = {
	label: string;
	/** The date spelled for a human: "Mon, Sep 7". */
	when: string;
	/** A calendar date, `yyyy-MM-dd` — what the server is sent, and the each key. */
	value: string;
};

/**
 * The snooze menu's date options, nearest horizon first.
 *
 * Presets carry the date they resolve to rather than a label the server has to
 * re-derive — picking "Next Monday" *is* picking a date, and two independent
 * derivations of "next Monday" is one too many.
 *
 * Extracted from `SnoozeMenu.svelte` so the collision below is testable without
 * a browser, the same way `thread-status.ts` sits beside its component.
 */
export function snoozePresets(now: Date): SnoozePreset[] {
	return [
		{ label: 'Tomorrow', date: addDays(now, 1) },
		{ label: 'Later this week', date: addDays(now, 3) },
		{ label: 'Next week', date: nextMonday(now) },
		{ label: 'In two weeks', date: addDays(now, 14) }
	]
		.map(({ label, date }) => ({
			label,
			when: formatDate(date),
			value: format(date, 'yyyy-MM-dd')
		}))
		.filter((preset, i, all) => all.findIndex((p) => p.value === preset.value) === i);
}
