import type { ReportRange } from './range';
import { ledgerWindow, toMoneySection, type MoneySection } from './money';
import { totalsByKindAndCategory } from '$lib/server/finance/financial-entry-service';
import {
	getVolunteerTotals,
	type VolunteerTotals
} from '$lib/server/volunteer/volunteer-report-service';
import { getProjectBurn, listProjects } from '$lib/server/project/project-service';
import type { ProjectStatus } from '$lib/config';

/**
 * One committee's cut of the annual rollup: the same module services, narrowed
 * to the committee's own projects and to hours logged against the committee.
 * Nothing organization-wide belongs here (#1562).
 */

export interface CommitteeProjectLine {
	id: string;
	name: string;
	status: ProjectStatus;
	budgetCents: number | null;
	/** Cash only. Contributed time and goods are never set against a budget. */
	spentCents: number;
	remainingCents: number | null;
}

export interface CommitteeReport {
	range: ReportRange;
	projects: CommitteeProjectLine[];
	money: MoneySection;
	volunteering: VolunteerTotals;
}

export async function getCommitteeReport(
	groupId: string,
	range: ReportRange
): Promise<CommitteeReport> {
	const projects = await listProjects({ groupId });

	const [entries, volunteering, burns] = await Promise.all([
		totalsByKindAndCategory(ledgerWindow(range), { projectIds: projects.map((p) => p.id) }),
		getVolunteerTotals(range, { groupId }),
		Promise.all(projects.map((p) => getProjectBurn(p.id)))
	]);

	return {
		range,
		projects: projects.map((p, i) => ({
			id: p.id,
			name: p.name,
			status: p.status,
			budgetCents: burns[i].budgetCents,
			spentCents: burns[i].cash.totalCents,
			remainingCents: burns[i].remainingCents
		})),
		money: toMoneySection(entries),
		volunteering
	};
}
