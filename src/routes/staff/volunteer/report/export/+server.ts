import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireStaff } from '$lib/server/authorization';
import { listApprovedHoursForExport } from '$lib/server/volunteer/volunteer-report-service';
import { getHourValueCents, getHourValueSource } from '$lib/server/volunteer/hour-value';
import { toCsv, csvResponse } from '$lib/server/report/csv';
import { valueOfMinutesCents } from '$lib/config';

const DATE = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.optional();

const rangeSchema = z.object({ from: DATE, to: DATE });

const COLUMNS = [
	'member',
	'email',
	'role',
	'specialized',
	'worked_on',
	'minutes',
	'hours',
	'impact_value',
	'recognizable_value',
	'description'
];

/**
 * The volunteer hours CSV.
 *
 * **A `+server.ts` rather than a remote function**, because a download needs a
 * `Content-Disposition` header and a `query()` returns a value rather than a
 * response. That makes this one of the few places in the app where the guard is
 * not the remote-function boundary, so `requireStaff()` is the first statement
 * here and the range is parsed with a schema exactly as a `form()` would.
 *
 * **Two value columns and no total row.** The impact figure covers every hour;
 * the recognizable figure covers only specialized ones. They overlap, so a
 * spreadsheet that summed both columns and put the result in a grant narrative
 * would double-count — and a footer row is an invitation to do precisely that.
 * Whoever opens this can sum a column themselves; nothing here suggests summing
 * across them.
 */
export const GET: RequestHandler = async ({ url }) => {
	await requireStaff();

	const range = rangeSchema.parse({
		from: url.searchParams.get('from') ?? undefined,
		to: url.searchParams.get('to') ?? undefined
	});

	const [rows, hourValueCents, hourValueSource] = await Promise.all([
		listApprovedHoursForExport(range),
		getHourValueCents(),
		getHourValueSource()
	]);

	const cents = (n: number) => (n / 100).toFixed(2);

	// ISO, not a localized format: a spreadsheet sorts it correctly and a funder
	// in another country reads it the same way. Safe as a plain UTC slice
	// because `workedOn` is anchored at noon club time, which is mid-day UTC at
	// every offset — the same reason `monthBucket` can bucket in UTC.
	const isoDate = (d: Date) => d.toISOString().slice(0, 10);

	const csv = toCsv(
		rows.map((row) => ({
			member: row.memberName,
			email: row.memberEmail,
			role: row.roleName,
			specialized: row.isSpecializedSkill ? 'yes' : 'no',
			worked_on: isoDate(row.workedOn),
			minutes: row.minutes,
			hours: (row.minutes / 60).toFixed(2),
			impact_value: cents(valueOfMinutesCents(row.minutes, hourValueCents)),
			// Blank, not zero, when a specialized role has no rate set: zero is a
			// claim that the hour was worth nothing, and an empty cell is the
			// truth, which is that nobody has priced it.
			recognizable_value:
				row.isSpecializedSkill && row.marketRateCents !== null
					? cents(valueOfMinutesCents(row.minutes, row.marketRateCents))
					: '',
			description: row.description ?? ''
		})),
		COLUMNS
	);

	// The rate and its provenance travel with the file. A funder-facing number
	// separated from the rate that produced it cannot be checked, and this file
	// outlives the page it was downloaded from.
	const suffix = [range.from ?? 'start', range.to ?? 'today'].join('_');
	const header = `# Impact value at $${cents(hourValueCents)}/hr — ${hourValueSource}\n`;

	return csvResponse(`volunteer-hours_${suffix}.csv`, header + csv);
};
