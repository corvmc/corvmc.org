import { db } from '#lib/server/db/index.js';
import {
	sponsorship,
	type NewSponsorship,
	type Sponsorship
} from '#lib/server/db/schema/sponsor.js';
import { organization } from '#lib/server/db/schema/party.js';
import { and, count, eq, gte, lte } from 'drizzle-orm';
import {
	createOrganization,
	getOrganizationInRole,
	listOrganizations,
	OrganizationNotFoundError,
	removeRole,
	requireRole,
	setOrganizationArchived,
	updateOrganization,
	type OrganizationInput
} from '#lib/server/party/organization-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import {
	deleteFundingProjectWrites,
	fundingCommitteeId,
	fundingProjectWrites,
	renameFundingProject
} from '#lib/server/development/funding-project.js';
import { byDeadline, due, type Deadline } from '#lib/utils/deadline.js';

export class SponsorNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Sponsor not found');
	}
}

/** A sponsor is an organization holding the `sponsor` role (#2622). */
async function getSponsorOrg(id: string) {
	try {
		return await getOrganizationInRole(id, 'sponsor');
	} catch (err) {
		if (err instanceof OrganizationNotFoundError) throw new SponsorNotFoundError();
		throw err;
	}
}

export class SponsorshipNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Sponsorship not found');
	}
}

export type SponsorshipDeadline = Deadline<'end'>;

/**
 * An active term's end, overdue once it has passed and nobody has marked it
 * ended or renewed. A pitch, a refusal and a finished term have none.
 */
export function sponsorshipDeadline(
	s: Pick<Sponsorship, 'status' | 'endsOn'>,
	today: string
): SponsorshipDeadline | null {
	return s.status === 'active' && s.endsOn ? due('end', s.endsOn, today) : null;
}

/** Every active term ending on a day in `[from, to]`, one subject per term. */
export async function listSponsorshipDeadlinesBetween(from: string, to: string) {
	const rows = await db
		.select({
			id: sponsorship.id,
			title: sponsorship.title,
			endsOn: sponsorship.endsOn,
			sponsorId: sponsorship.organizationId,
			sponsorName: organization.name
		})
		.from(sponsorship)
		.innerJoin(organization, eq(organization.id, sponsorship.organizationId))
		.where(
			and(
				eq(sponsorship.status, 'active'),
				gte(sponsorship.endsOn, from),
				lte(sponsorship.endsOn, to)
			)
		);
	return rows.map((r) => ({
		kind: 'end' as const,
		on: r.endsOn!,
		subjectId: `sponsorship:${r.id}`,
		title: 'Sponsorship ends',
		parentId: r.sponsorId,
		parentTitle: r.title,
		counterparty: r.sponsorName
	}));
}

type ShipSummary = Pick<
	Sponsorship,
	'id' | 'organizationId' | 'title' | 'tier' | 'status' | 'amountCents' | 'startsOn' | 'endsOn'
>;

/** A running term beats a pitch as "current"; anything else is history. */
function currentOf<T extends ShipSummary>(ships: T[]): T | null {
	const active = ships
		.filter((s) => s.status === 'active')
		.sort((a, b) => (a.endsOn ?? '9').localeCompare(b.endsOn ?? '9'));
	return active[0] ?? ships.find((s) => s.status === 'prospect') ?? null;
}

/** Each sponsor with its current sponsorship, soonest-ending first. */
export function summarizeSponsors<S extends { id: string; name: string }, T extends ShipSummary>(
	sponsors: S[],
	ships: T[],
	today: string
) {
	return sponsors
		.map((s) => {
			const mine = ships.filter((p) => p.organizationId === s.id);
			const current = currentOf(mine);
			return {
				...s,
				current,
				sponsorships: mine.length,
				deadline: current ? sponsorshipDeadline(current, today) : null
			};
		})
		.sort(byDeadline((r) => r.name));
}

export async function listSponsors(
	today: string,
	{ includeArchived = false }: { includeArchived?: boolean } = {}
) {
	const [sponsors, ships] = await Promise.all([
		listOrganizations({ role: 'sponsor', includeArchived }),
		db.select().from(sponsorship)
	]);
	return summarizeSponsors(sponsors, ships, today);
}

export async function getSponsor(id: string, today: string) {
	const row = await getSponsorOrg(id);
	const ships = await db.select().from(sponsorship).where(eq(sponsorship.organizationId, id));
	return {
		...row,
		sponsorships: ships
			.map((s) => ({ ...s, deadline: sponsorshipDeadline(s, today) }))
			// Newest first; an undated pitch is the newest thing there is.
			.sort((a, b) => (b.startsOn ?? '9').localeCompare(a.startsOn ?? '9'))
	};
}

export type SponsorInput = OrganizationInput;

export function createSponsor(input: SponsorInput) {
	return createOrganization(input, ['sponsor']);
}

export async function updateSponsor(id: string, input: SponsorInput): Promise<void> {
	await getSponsorOrg(id);
	await updateOrganization(id, input);
}

/** Off the active list; its sponsorships, placements and logo all stay. */
export async function archiveSponsor(id: string): Promise<void> {
	await getSponsorOrg(id);
	await setOrganizationArchived(id, true);
}

export async function restoreSponsor(id: string): Promise<void> {
	await getSponsorOrg(id);
	await setOrganizationArchived(id, false);
}

/** Only for a row that should never have been a sponsor. Refused once a sponsorship names it. */
export async function deleteSponsor(id: string): Promise<void> {
	await getSponsorOrg(id);
	const [used] = await db
		.select({ n: count() })
		.from(sponsorship)
		.where(eq(sponsorship.organizationId, id));
	await removeRole(id, 'sponsor', Number(used?.n ?? 0));
}

export type SponsorshipInput = Omit<
	NewSponsorship,
	'id' | 'projectId' | 'fundsProjectId' | 'createdAt' | 'updatedAt'
>;

/** The sponsorship and its project, owned by the committee holding `sponsor.manage`. */
export async function createSponsorship(
	input: SponsorshipInput,
	opts: { createdByUserId?: string | null } = {}
): Promise<Sponsorship> {
	await requireRole(input.organizationId, 'sponsor');
	const projectId = crypto.randomUUID();
	const id = crypto.randomUUID();
	await db.batch([
		...fundingProjectWrites({
			projectId,
			kind: 'sponsorship',
			name: input.title,
			ownerGroupId: await fundingCommitteeId('sponsorship'),
			createdByUserId: opts.createdByUserId ?? null
		}),
		db.insert(sponsorship).values({ ...input, id, projectId })
	]);
	const [row] = await db.select().from(sponsorship).where(eq(sponsorship.id, id));
	return row;
}

export async function updateSponsorship(
	id: string,
	input: Omit<SponsorshipInput, 'organizationId'>
): Promise<void> {
	const rows = await db
		.update(sponsorship)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(sponsorship.id, id))
		.returning({ projectId: sponsorship.projectId });
	if (rows.length === 0) throw new SponsorshipNotFoundError();
	if (rows[0].projectId) await renameFundingProject(rows[0].projectId, input.title);
}

/** Its placements, its project and that project's tasks go with it. */
export async function deleteSponsorship(id: string): Promise<void> {
	const [row] = await db
		.select({ projectId: sponsorship.projectId })
		.from(sponsorship)
		.where(eq(sponsorship.id, id))
		.limit(1);
	if (!row) throw new SponsorshipNotFoundError();
	await db.batch([
		db.delete(sponsorship).where(eq(sponsorship.id, id)),
		...(row.projectId ? deleteFundingProjectWrites(row.projectId) : [])
	]);
}
