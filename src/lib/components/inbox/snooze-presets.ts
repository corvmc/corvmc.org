import { addDays, format, isBefore, isSameDay, nextMonday } from 'date-fns';
import { formatDate } from '$lib/utils/format';

export type SnoozePreset = {
	/** The row's label, and its identity — stable whatever date it resolves to. */
	label: string;
	/** The date, spelled for a human: "Mon, Sep 7". */
	when: string;
	/** The date the server stores, `yyyy-MM-dd`. */
	value: string;
};

/**
 * The dated snooze options, given the moment the menu opened.
 *
 * Pure and parameterised on `now` because the options collide on some weekdays
 * and not others, and a menu that renders on a Tuesday proves nothing about the
 * one that renders on a Friday.
 */
export function snoozePresets(now: Date): SnoozePreset[] {
	const tomorrow = addDays(now, 1);
	const laterThisWeek = addDays(now, 3);
	const monday = nextMonday(now);

	return [
		{ label: 'Tomorrow', date: tomorrow },
		// Gone from Friday on: `now + 3` has crossed into next week by then, so
		// the row would name the same day as "Next week" under a label that is no
		// longer true.
		...(isBefore(laterThisWeek, monday) ? [{ label: 'Later this week', date: laterThisWeek }] : []),
		// Gone on Sunday, when next Monday is simply tomorrow.
		...(isSameDay(monday, tomorrow) ? [] : [{ label: 'Next week', date: monday }]),
		{ label: 'In two weeks', date: addDays(now, 14) }
	].map(({ label, date }) => ({
		label,
		when: formatDate(date),
		value: format(date, 'yyyy-MM-dd')
	}));
}
