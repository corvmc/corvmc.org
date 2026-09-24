import { db } from '$lib/server/db';
import {
	funder,
	grantApplication,
	grantReport,
	type GrantApplication,
	type GrantReport,
	type NewGrantApplication,
	type NewGrantReport
} from '$lib/server/db/schema/grant';
import { asc, eq, inArray, isNull } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import {
	grantDeadlineLabels,
	openGrantStatuses,
	type GrantDeadlineKind,
	type GrantStatus
} from '$lib/config';
import { byDeadline, due, earliest, type Deadline } from '$lib/utils/deadline';

export class GrantNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Grant application not found');
	}
}

export class GrantReportNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Report not found');
	}
}

export type GrantDeadline = Deadline<GrantDeadlineKind>;

type ReportDates = Pick<GrantReport, 'dueOn' | 'submittedOn'>;

type GrantDates = Pick<GrantApplication, 'status' | 'applyBy' | 'endsOn'>;

/**
 * Every deadline still open on an application. A prospect owes its application;
 * an award owes each outstanding report and the end of the award period. An
 * outstanding report stays owed after the grant is closed, since a final
 * report usually falls due after the money is spent.
 */
function openDeadlines<R extends ReportDates>(g: GrantDates, reports: R[]) {
	type Open = { kind: GrantDeadlineKind; on: string; report?: R };
	if (g.status === 'prospect') return g.applyBy ? [{ kind: 'apply', on: g.applyBy } as Open] : [];
	if (g.status !== 'awarded' && g.status !== 'closed') return [];

	const open: Open[] = reports
		.filter((r) => !r.submittedOn)
		.map((r) => ({ kind: 'report', on: r.dueOn, report: r }));
	if (g.status === 'awarded' && g.endsOn) open.push({ kind: 'end', on: g.endsOn });
	return open;
}

/** What comes due next: the soonest of `openDeadlines`. */
export function grantDeadline(
	g: GrantDates,
	reports: ReportDates[],
	today: string
): GrantDeadline | null {
	return earliest<GrantDeadlineKind>(
		...openDeadlines(g, reports).map((d) => due(d.kind, d.on, today))
	);
}

/**
 * Each open deadline with a subject id of its own, so a reminder about one
 * report is not also the reminder about the next.
 */
export function grantDeadlineItems(
	g: GrantDates & { id: string },
	reports: (ReportDates & { id: string; title: string })[]
) {
	return openDeadlines(g, reports).map((d) => ({
		kind: d.kind,
		on: d.on,
		subjectId: d.report ? `report:${d.report.id}` : `${d.kind}:${g.id}`,
		title: d.report ? d.report.title : grantDeadlineLabels[d.kind]
	}));
}

/** Every open grant deadline falling on a day in `[from, to]`. */
export async function listGrantDeadlinesBetween(from: string, to: string) {
	const [apps, reports] = await Promise.all([
		db
			.select({
				id: grantApplication.id,
				title: grantApplication.title,
				status: grantApplication.status,
				applyBy: grantApplication.applyBy,
				endsOn: grantApplication.endsOn,
				funderName: funder.name
			})
			.from(grantApplication)
			.innerJoin(funder, eq(funder.id, grantApplication.funderId))
			.where(inArray(grantApplication.status, ['prospect', 'awarded', 'closed'])),
		db
			.select({
				id: grantReport.id,
				grantApplicationId: grantReport.grantApplicationId,
				title: grantReport.title,
				dueOn: grantReport.dueOn,
				submittedOn: grantReport.submittedOn
			})
			.from(grantReport)
			.where(isNull(grantReport.submittedOn))
	]);
	return apps.flatMap((g) =>
		grantDeadlineItems(
			g,
			reports.filter((r) => r.grantApplicationId === g.id)
		)
			.filter((d) => d.on >= from && d.on <= to)
			.map((d) => ({ ...d, parentId: g.id, parentTitle: g.title, counterparty: g.funderName }))
	);
}

/** Attach each application's deadline and sort soonest first, undated last. */
export function withDeadlines<
	G extends Pick<GrantApplication, 'id' | 'status' | 'applyBy' | 'endsOn'> & { funderName: string }
>(apps: G[], reports: (ReportDates & { grantApplicationId: string })[], today: string) {
	return apps
		.map((g) => ({
			...g,
			deadline: grantDeadline(
				g,
				reports.filter((r) => r.grantApplicationId === g.id),
				today
			)
		}))
		.sort(byDeadline((r) => r.funderName));
}

const open: readonly GrantStatus[] = openGrantStatuses;

export async function listGrants(opts: { today: string; includeClosed?: boolean }) {
	const [apps, reports] = await Promise.all([
		db
			.select({
				id: grantApplication.id,
				title: grantApplication.title,
				status: grantApplication.status,
				amountRequestedCents: grantApplication.amountRequestedCents,
				amountAwardedCents: grantApplication.amountAwardedCents,
				applyBy: grantApplication.applyBy,
				endsOn: grantApplication.endsOn,
				funderId: grantApplication.funderId,
				funderName: funder.name
			})
			.from(grantApplication)
			.innerJoin(funder, eq(funder.id, grantApplication.funderId)),
		db
			.select({
				grantApplicationId: grantReport.grantApplicationId,
				dueOn: grantReport.dueOn,
				submittedOn: grantReport.submittedOn
			})
			.from(grantReport)
			.where(isNull(grantReport.submittedOn))
	]);
	return withDeadlines(apps, reports, opts.today).filter(
		(g) => opts.includeClosed || open.includes(g.status) || g.deadline
	);
}

export async function getGrant(id: string, today: string) {
	const [row] = await db
		.select({ grant: grantApplication, funderName: funder.name })
		.from(grantApplication)
		.innerJoin(funder, eq(funder.id, grantApplication.funderId))
		.where(eq(grantApplication.id, id))
		.limit(1);
	if (!row) throw new GrantNotFoundError();

	const reports = await db
		.select()
		.from(grantReport)
		.where(eq(grantReport.grantApplicationId, id))
		.orderBy(asc(grantReport.dueOn));
	return {
		...row.grant,
		funderName: row.funderName,
		reports: reports.map((r) => ({
			...r,
			overdue: !r.submittedOn && due('report', r.dueOn, today).overdue
		})),
		deadline: grantDeadline(row.grant, reports, today)
	};
}

export type GrantInput = Omit<NewGrantApplication, 'id' | 'createdAt' | 'updatedAt'>;

export async function createGrant(input: GrantInput): Promise<GrantApplication> {
	const [row] = await db.insert(grantApplication).values(input).returning();
	return row;
}

export async function updateGrant(id: string, input: GrantInput): Promise<void> {
	const rows = await db
		.update(grantApplication)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(grantApplication.id, id))
		.returning({ id: grantApplication.id });
	if (rows.length === 0) throw new GrantNotFoundError();
}

/** Its reports go with it (cascade). */
export async function deleteGrant(id: string): Promise<void> {
	const rows = await db
		.delete(grantApplication)
		.where(eq(grantApplication.id, id))
		.returning({ id: grantApplication.id });
	if (rows.length === 0) throw new GrantNotFoundError();
}

export type GrantReportInput = Omit<NewGrantReport, 'id' | 'createdAt' | 'updatedAt'>;

export async function addGrantReport(input: GrantReportInput): Promise<void> {
	await db.insert(grantReport).values(input);
}

export async function updateGrantReport(
	id: string,
	input: Omit<GrantReportInput, 'grantApplicationId'>
): Promise<void> {
	const rows = await db
		.update(grantReport)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(grantReport.id, id))
		.returning({ id: grantReport.id });
	if (rows.length === 0) throw new GrantReportNotFoundError();
}

export async function deleteGrantReport(id: string): Promise<void> {
	const rows = await db
		.delete(grantReport)
		.where(eq(grantReport.id, id))
		.returning({ id: grantReport.id });
	if (rows.length === 0) throw new GrantReportNotFoundError();
}
