import { db } from '#lib/server/db/index.js';
import {
	sponsorship,
	type NewSponsorship,
	type Sponsorship
} from '#lib/server/db/schema/sponsor.js';
import { organization } from '#lib/server/db/schema/party.js';
import { and, eq, gte, lte } from 'drizzle-orm';
import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import {
	getOrganizationInRole,
	OrganizationNotFoundError,
	requireRole,
	updateOrganization,
	type OrganizationInput
} from '#lib/server/party/organization-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import {
	assertFundable,
	deleteFundingProjectWrites,
	fundingCommitteeId,
	fundingProjectWrites,
	nextOpenTasks,
	renameFundingProject
} from '#lib/server/development/funding-project.js';
import { due, type Deadline } from '#lib/utils/deadline.js';

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

export async function getSponsor(id: string, today: string) {
	const row = await getSponsorOrg(id);
	const ships = await db.select().from(sponsorship).where(eq(sponsorship.organizationId, id));
	const next = await nextOpenTasks(ships.flatMap((s) => (s.projectId ? [s.projectId] : [])));
	return {
		...row,
		sponsorships: ships
			.map((s) => ({
				...s,
				deadline: sponsorshipDeadline(s, today),
				nextTask: (s.projectId && next.get(s.projectId)) || null
			}))
			// Newest first; an undated pitch is the newest thing there is.
			.sort((a, b) => (b.startsOn ?? '9').localeCompare(a.startsOn ?? '9'))
	};
}

export type SponsorInput = OrganizationInput;

export async function updateSponsor(id: string, input: SponsorInput): Promise<void> {
	await getSponsorOrg(id);
	await updateOrganization(id, input);
}

export type SponsorshipInput = Omit<NewSponsorship, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>;

/** The sponsorship and its project, owned by the committee holding `sponsor.manage`. */
export async function createSponsorship(
	input: SponsorshipInput,
	opts: { createdByUserId?: string | null } = {}
): Promise<Sponsorship> {
	await requireRole(input.organizationId, 'sponsor');
	await assertFundable(input.fundsProjectId);
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
	await assertFundable(input.fundsProjectId);
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
		.select({
			projectId: sponsorship.projectId,
			title: sponsorship.title,
			amountCents: sponsorship.amountCents,
			sponsorId: sponsorship.organizationId,
			sponsorName: organization.name
		})
		.from(sponsorship)
		.leftJoin(organization, eq(organization.id, sponsorship.organizationId))
		.where(eq(sponsorship.id, id))
		.limit(1);
	if (!row) throw new SponsorshipNotFoundError();
	await db.batch([
		db.delete(sponsorship).where(eq(sponsorship.id, id)),
		...(row.projectId ? deleteFundingProjectWrites(row.projectId) : [])
	]);
	await recordAuditEntry({
		action: 'sponsorship.deleted',
		subject: { type: 'organization', id: row.sponsorId, label: row.sponsorName },
		details: { sponsorshipId: id, title: row.title, amountCents: row.amountCents }
	});
}
