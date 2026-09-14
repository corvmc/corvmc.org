import { z } from 'zod';
import { query } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { getAnnualReport } from '$lib/server/report/annual-report-service';

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
