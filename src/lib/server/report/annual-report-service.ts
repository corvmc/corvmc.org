import type { ReportRange } from './range';
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
import { ledgerWindow, toMoneySection, type MoneySection } from './money';

export type { CategoryLine, MoneySection } from './money';

/**
 * The annual rollup: one call, every module's own report service.
 *
 * It writes no queries of its own by design. A number here that disagrees with
 * the module page it came from would be a second implementation drifting, and
 * the board packet is the worst place to discover one.
 */

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

	return {
		range,
		coverage: {
			startsAt,
			complete: startsAt === null || window.from >= startsAt
		},
		money: toMoneySection(entries),
		volunteering: { totals, contributed },
		membership,
		events,
		room
	};
}
