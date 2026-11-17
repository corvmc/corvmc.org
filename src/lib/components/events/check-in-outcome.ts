import { formatTime } from '#lib/utils/format.js';

/** What `checkIn` answers, so every door path carries the repeat (#933, #3204). */
export type CheckInResult = { alreadyIn: boolean; checkedInAt: Date };

/**
 * What the door person is told after one check-in. The scanner and every list
 * row read the same answer, so a repeat warns wherever it was tapped.
 */
export function checkInOutcome(
	name: string,
	result: CheckInResult
): { tone: 'success' | 'warning'; text: string } {
	return result.alreadyIn
		? { tone: 'warning', text: `${name} was already in at ${formatTime(result.checkedInAt)}` }
		: { tone: 'success', text: `${name} is in` };
}
