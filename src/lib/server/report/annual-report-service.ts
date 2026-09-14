import { rangeInstants, type ReportRange } from './range';
import {
	ledgerStartsAt,
	totalsByKindAndCategory
} from '$lib/server/finance/financial-entry-service';
import {
	getVolunteerTotals,
	getContributedValue,
	type VolunteerTotals
} from '$lib/server/volunteer/volunteer-report-service';
import type { ContributedValue } from '$lib/server/volunteer/hour-value';
import { getCommunityStats, type CommunityStats } from '$lib/server/finance/community-stats';
import { getEventTotals, type EventTotals } from '$lib/server/event/event-report-service';
import {
	getRoomUseTotals,
	type RoomUseTotals
} from '$lib/server/reservation/reservation-report-service';
import { financialEntryKinds, type FinancialCategory, type FinancialEntryKind } from '$lib/config';

/**
 * The annual rollup: one call, every module's own report service.
 *
 * It writes no queries of its own by design. A number here that disagrees with
 * the module page it came from would be a second implementation drifting, and
 * the board packet is the worst place to discover one.
 */

export interface CategoryLine {
	category: FinancialCategory;
	totalCents: number;
}

export interface MoneySection {
	byKind: Record<FinancialEntryKind, CategoryLine[]>;
	totalsByKind: Record<FinancialEntryKind, number>;
	/** Earned less spent. Excludes in-kind and pass-through, which are not income. */
	netCents: number;
}

/**
 * What the record can and cannot answer for the range asked for.
 *
 * The ledger begins where the app's payment history begins. A range reaching
 * further back sums to a smaller number rather than erroring, so the page has
 * to say so: a revenue figure that under-reports confidently is the failure.
 */
export interface LedgerCoverage {
	startsAt: Date | null;
	/**
	 * True when the requested range begins at or after the first recorded entry.
	 * An unbounded request is false: it asks for all time and gets the ledger's
	 * lifetime, which is a smaller thing and should say so.
	 */
	complete: boolean;
}

export interface AnnualReport {
	range: ReportRange;
	coverage: LedgerCoverage;
	money: MoneySection;
	volunteering: { totals: VolunteerTotals; contributed: ContributedValue };
	membership: CommunityStats;
	events: EventTotals;
	room: RoomUseTotals;
}

/**
 * Both ends resolved, because the ledger's filter is bounded on both sides.
 *
 * An open-ended report is still a real request — "everything so far" — so the
 * ends are filled rather than refused. The far past is the epoch; the far
 * future is now, since a report cannot include what has not happened.
 */
function ledgerWindow(range: ReportRange): { from: Date; to: Date } {
	const { from, to } = rangeInstants(range);
	return { from: from ?? new Date(0), to: to ?? new Date() };
}

function emptyByKind<T>(value: () => T): Record<FinancialEntryKind, T> {
	return Object.fromEntries(financialEntryKinds.map((k) => [k, value()])) as Record<
		FinancialEntryKind,
		T
	>;
}

export async function getAnnualReport(range: ReportRange = {}): Promise<AnnualReport> {
	const window = ledgerWindow(range);

	const [entries, startsAt, totals, contributed, membership, events, room] = await Promise.all([
		totalsByKindAndCategory(window),
		ledgerStartsAt(),
		getVolunteerTotals(range),
		getContributedValue(range),
		getCommunityStats(),
		getEventTotals(range),
		getRoomUseTotals(range)
	]);

	const byKind = emptyByKind<CategoryLine[]>(() => []);
	const totalsByKind = emptyByKind<number>(() => 0);
	for (const entry of entries) {
		byKind[entry.kind].push({ category: entry.category, totalCents: entry.totalCents });
		totalsByKind[entry.kind] += entry.totalCents;
	}
	for (const kind of financialEntryKinds) {
		byKind[kind].sort((a, b) => b.totalCents - a.totalCents);
	}

	return {
		range,
		coverage: {
			startsAt,
			complete: startsAt === null || window.from >= startsAt
		},
		money: {
			byKind,
			totalsByKind,
			netCents: totalsByKind.earned - totalsByKind.spent
		},
		volunteering: { totals, contributed },
		membership,
		events,
		room
	};
}
