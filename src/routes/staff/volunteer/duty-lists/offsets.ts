/**
 * Rendering signed minutes back into the words staff typed them in.
 *
 * The column stores minutes because that is the only unit the arithmetic wants;
 * nobody should read "-10080" and have to work out that it means a week.
 */

/** "3 hours before doors", "at doors", "4 days after event end". */
export function describeOffset(minutes: number, anchorLabel: string): string {
	const anchor = anchorLabel.toLowerCase();
	if (minutes === 0) return `at ${anchor}`;

	const abs = Math.abs(minutes);
	let amount: string;
	if (abs % 1440 === 0) {
		const days = abs / 1440;
		amount = `${days} ${days === 1 ? 'day' : 'days'}`;
	} else if (abs % 60 === 0) {
		const hours = abs / 60;
		amount = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	} else {
		amount = `${abs} min`;
	}

	return `${amount} ${minutes < 0 ? 'before' : 'after'} ${anchor}`;
}

/** "3 hrs" for whole hours, "1.5 hrs" otherwise — matching the hour log's own rendering. */
export function describeDuration(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const hours = minutes / 60;
	return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
}
