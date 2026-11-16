import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { grantApplication } from '#lib/server/db/schema/grant.js';
import { sponsorship } from '#lib/server/db/schema/sponsor.js';
import { organization } from '#lib/server/db/schema/party.js';
import { grantDeadline } from '#lib/server/grant/grant-service.js';
import { sponsorshipDeadline } from '#lib/server/sponsor/sponsor-service.js';
import { nextOpenTasks, type NextTask } from './funding-project';
import {
	clubToday,
	fundingStages,
	type FundingStage,
	type GrantStatus,
	type SponsorshipStatus
} from '#lib/config.js';
import type { Deadline } from '#lib/utils/deadline.js';

/**
 * Grant applications and sponsorships on one list (#2622): grouped by stage,
 * each with its next open task and its own deadline, soonest first. Each
 * module is read only when asked for, so a caller who may see one never loads
 * the other.
 */

const grantStage: Record<GrantStatus, FundingStage> = {
	prospect: 'prospect',
	applied: 'applied',
	awarded: 'active',
	declined: 'closed',
	closed: 'closed'
};

const sponsorshipStage: Record<SponsorshipStatus, FundingStage> = {
	prospect: 'prospect',
	active: 'active',
	ended: 'closed',
	declined: 'closed'
};

export type FundingRow = {
	id: string;
	title: string;
	organizationId: string;
	organizationName: string;
	stage: FundingStage;
	/** What was awarded or agreed, else what was asked. */
	amountCents: number | null;
	/** The amount is an ask, not yet money agreed. */
	asked: boolean;
	deadline: Deadline | null;
	nextTask: NextTask | null;
	projectId: string | null;
	/** The day the row next needs something: its next task's or its deadline, whichever is sooner. */
	nextOn: string | null;
} & ({ kind: 'grant'; status: GrantStatus } | { kind: 'sponsorship'; status: SponsorshipStatus });

function soonest(...days: (string | null | undefined)[]): string | null {
	const set = days.filter((d): d is string => Boolean(d)).sort();
	return set[0] ?? null;
}

/** Stage order, then soonest next day, undated last, then by organization. */
export function byFundingOrder(a: FundingRow, b: FundingRow): number {
	const stage = fundingStages.indexOf(a.stage) - fundingStages.indexOf(b.stage);
	if (stage !== 0) return stage;
	if (a.nextOn !== b.nextOn) {
		if (!a.nextOn) return 1;
		if (!b.nextOn) return -1;
		return a.nextOn < b.nextOn ? -1 : 1;
	}
	return a.organizationName.localeCompare(b.organizationName);
}

export async function listFunding(opts: {
	today: string;
	grants: boolean;
	sponsors: boolean;
	includeClosed?: boolean;
}): Promise<FundingRow[]> {
	const [apps, ships] = await Promise.all([
		opts.grants
			? db
					.select({ g: grantApplication, organizationName: organization.name })
					.from(grantApplication)
					.innerJoin(organization, eq(organization.id, grantApplication.organizationId))
			: [],
		opts.sponsors
			? db
					.select({ s: sponsorship, organizationName: organization.name })
					.from(sponsorship)
					.innerJoin(organization, eq(organization.id, sponsorship.organizationId))
			: []
	]);
	const projectIds = [...apps.map((r) => r.g.projectId), ...ships.map((r) => r.s.projectId)];
	const next = await nextOpenTasks(projectIds.filter((id): id is string => Boolean(id)));
	const taskOf = (projectId: string | null) => (projectId && next.get(projectId)) || null;
	const day = (task: NextTask | null) => (task?.dueAt ? clubToday(task.dueAt) : null);

	const rows: FundingRow[] = [
		...apps.map(({ g, organizationName }) => {
			const deadline = grantDeadline(g, opts.today);
			const nextTask = taskOf(g.projectId);
			return {
				kind: 'grant' as const,
				id: g.id,
				title: g.title,
				status: g.status,
				organizationId: g.organizationId,
				organizationName,
				stage: grantStage[g.status],
				amountCents: g.amountAwardedCents ?? g.amountRequestedCents,
				asked: g.amountAwardedCents === null && g.amountRequestedCents !== null,
				deadline,
				nextTask,
				projectId: g.projectId,
				nextOn: soonest(day(nextTask), deadline?.on)
			};
		}),
		...ships.map(({ s, organizationName }) => {
			const deadline = sponsorshipDeadline(s, opts.today);
			const nextTask = taskOf(s.projectId);
			return {
				kind: 'sponsorship' as const,
				id: s.id,
				title: s.title,
				status: s.status,
				organizationId: s.organizationId,
				organizationName,
				stage: sponsorshipStage[s.status],
				amountCents: s.amountCents,
				asked: s.status === 'prospect' && s.amountCents !== null,
				deadline,
				nextTask,
				projectId: s.projectId,
				nextOn: soonest(day(nextTask), deadline?.on)
			};
		})
	];
	return rows
		.filter((r) => opts.includeClosed || r.stage !== 'closed' || r.nextTask || r.deadline)
		.sort(byFundingOrder);
}
