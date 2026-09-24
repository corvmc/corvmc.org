import { z } from 'zod';
import { query } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { getAnnualReport } from '$lib/server/report/annual-report-service';
import { getCommitteeReport } from '$lib/server/report/committee-report-service';
import { requireCommitteeMember } from '$lib/server/group/group-context';

/**
 * The annual report, as one query.
 *
 * `finance.read` rather than a capability of its own: every line here is
 * already readable on the module page it came from, and the money section is
 * the one that decides who may see the page at all.
 */
export const getAnnualReportPage = query(
	z.object({ from: z.string().optional(), to: z.string().optional() }),
	async ({ from, to }) => {
		await requireCapability('finance.read');
		return getAnnualReport({ from: from || undefined, to: to || undefined });
	}
);

/**
 * One committee's cut of the same rollup, for its own members (#1562).
 * `finance.read` is staff cover, the capability that reads the whole report.
 */
export const getCommitteeNumbers = query(
	z.object({ groupId: z.uuid(), from: z.string().optional(), to: z.string().optional() }),
	async ({ groupId, from, to }) => {
		await requireCommitteeMember(groupId, 'finance.read');
		return getCommitteeReport(groupId, { from: from || undefined, to: to || undefined });
	}
);
