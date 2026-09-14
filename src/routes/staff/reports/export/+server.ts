import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireCapability } from '$lib/server/authorization';
import { getAnnualReport, type AnnualReport } from '$lib/server/report/annual-report-service';
import { toCsv, csvResponse } from '$lib/server/report/csv';
import {
	financialCategoryLabels,
	financialEntryKindLabels,
	eventKindLabels,
	financialEntryKinds
} from '$lib/config';

const DATE = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.optional();

const rangeSchema = z.object({ from: DATE, to: DATE });

const COLUMNS = ['section', 'line', 'value', 'unit'];

interface Row {
	section: string;
	line: string;
	value: string | number;
	unit: 'dollars' | 'hours' | 'count' | 'percent';
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

/**
 * The whole report as one long-format file.
 *
 * Four columns rather than one per figure: the sections share no unit, and
 * long format survives a new line without shifting anyone's columns — which
 * matters for a file pasted into the same board spreadsheet every year.
 */
function toRows(report: AnnualReport): Row[] {
	const rows: Row[] = [];

	for (const kind of financialEntryKinds) {
		const section = financialEntryKindLabels[kind];
		for (const line of report.money.byKind[kind]) {
			rows.push({
				section,
				line: financialCategoryLabels[line.category],
				value: dollars(line.totalCents),
				unit: 'dollars'
			});
		}
		rows.push({
			section,
			line: 'Total',
			value: dollars(report.money.totalsByKind[kind]),
			unit: 'dollars'
		});
	}

	rows.push({
		section: 'Net',
		line: 'Earned less spent',
		value: dollars(report.money.netCents),
		unit: 'dollars'
	});

	const { totals, contributed } = report.volunteering;
	rows.push({
		section: 'Donated time',
		line: 'Approved hours',
		value: (totals.totalMinutes / 60).toFixed(2),
		unit: 'hours'
	});
	rows.push({
		section: 'Donated time',
		line: 'Volunteers',
		value: totals.volunteerCount,
		unit: 'count'
	});
	rows.push({
		section: 'Donated time',
		line: 'Impact value',
		value: dollars(contributed.impactValueCents),
		unit: 'dollars'
	});
	rows.push({
		section: 'Donated time',
		line: 'Contributed services',
		value: dollars(contributed.recognizableServicesCents),
		unit: 'dollars'
	});

	rows.push({
		section: 'Events',
		line: 'CMC events held',
		value: report.events.cmcTotal,
		unit: 'count'
	});
	for (const [kind, label] of Object.entries(eventKindLabels)) {
		rows.push({
			section: 'Events',
			line: label,
			value: report.events.cmcByKind[kind as keyof typeof eventKindLabels],
			unit: 'count'
		});
	}
	rows.push({
		section: 'Events',
		line: 'Band listings',
		value: report.events.bandListings,
		unit: 'count'
	});
	rows.push({
		section: 'Events',
		line: 'Community listings',
		value: report.events.communityListings,
		unit: 'count'
	});
	rows.push({
		section: 'Events',
		line: 'Cancelled',
		value: report.events.cancelled,
		unit: 'count'
	});

	rows.push({
		section: 'Practice room',
		line: 'Hours booked',
		value: report.room.hours,
		unit: 'hours'
	});
	rows.push({
		section: 'Practice room',
		line: 'Sessions',
		value: report.room.sessions,
		unit: 'count'
	});
	rows.push({
		section: 'Practice room',
		line: 'Distinct bookers',
		value: report.room.distinctBookers,
		unit: 'count'
	});
	rows.push({
		section: 'Practice room',
		line: 'No-shows',
		value: report.room.noShows,
		unit: 'count'
	});

	rows.push({
		section: 'Membership',
		line: 'Sustaining members',
		value: report.membership.sustainingMemberCount,
		unit: 'count'
	});
	rows.push({
		section: 'Membership',
		line: 'Practice hours funded',
		value: report.membership.totalFreeHoursAllocated,
		unit: 'hours'
	});
	rows.push({
		section: 'Membership',
		line: 'Participation',
		value: report.membership.participationPercent,
		unit: 'percent'
	});

	return rows;
}

export const GET: RequestHandler = async ({ url }) => {
	// The guard is here rather than at a remote-function boundary: a download
	// needs `Content-Disposition`, which a `query()` cannot set.
	await requireCapability('finance.read');

	const range = rangeSchema.parse({
		from: url.searchParams.get('from') ?? undefined,
		to: url.searchParams.get('to') ?? undefined
	});

	const report = await getAnnualReport(range);
	const csv = toCsv(toRows(report) as unknown as Array<Record<string, unknown>>, COLUMNS);

	// The caveats travel with the file, because this one outlives the page that
	// produced it and gets read by someone who never saw the banner.
	const notes = [
		`# CorvMC report — ${range.from ?? 'start'} to ${range.to ?? 'today'}`,
		report.coverage.startsAt
			? `# Financial record begins ${report.coverage.startsAt.toISOString().slice(0, 10)}; earlier income was never recorded in the app.`
			: '# The financial record is empty for every range.',
		'# Impact value and contributed services overlap — do not add them.',
		'# Membership figures are as of the download, not the range.'
	].join('\n');

	const suffix = [range.from ?? 'start', range.to ?? 'today'].join('_');
	return csvResponse(`cmc-report_${suffix}.csv`, `${notes}\n${csv}`);
};
