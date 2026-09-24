import { db } from '$lib/server/db';
import {
	sponsor,
	sponsorship,
	type NewSponsor,
	type NewSponsorship,
	type Sponsor,
	type Sponsorship
} from '$lib/server/db/schema/sponsor';
import { count, eq } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { byDeadline, due, type Deadline } from '$lib/utils/deadline';

export class SponsorNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Sponsor not found');
	}
}

export class SponsorshipNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Sponsorship not found');
	}
}

export class SponsorInUseError extends DomainError {
	readonly httpStatus = 409;
	constructor(n: number) {
		super(
			`${n} ${n === 1 ? 'sponsorship names' : 'sponsorships name'} this sponsor. Delete ${n === 1 ? 'it' : 'them'} first.`
		);
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

type ShipSummary = Pick<
	Sponsorship,
	'id' | 'sponsorId' | 'title' | 'tier' | 'status' | 'amountCents' | 'startsOn' | 'endsOn'
>;

/** A running term beats a pitch as "current"; anything else is history. */
function currentOf<T extends ShipSummary>(ships: T[]): T | null {
	const active = ships
		.filter((s) => s.status === 'active')
		.sort((a, b) => (a.endsOn ?? '9').localeCompare(b.endsOn ?? '9'));
	return active[0] ?? ships.find((s) => s.status === 'prospect') ?? null;
}

/** Each sponsor with its current sponsorship, soonest-ending first. */
export function summarizeSponsors<S extends Pick<Sponsor, 'id' | 'name'>, T extends ShipSummary>(
	sponsors: S[],
	ships: T[],
	today: string
) {
	return sponsors
		.map((s) => {
			const mine = ships.filter((p) => p.sponsorId === s.id);
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

export async function listSponsors(today: string) {
	const [sponsors, ships] = await Promise.all([
		db.select().from(sponsor),
		db.select().from(sponsorship)
	]);
	return summarizeSponsors(sponsors, ships, today);
}

export async function getSponsor(id: string, today: string) {
	const [row] = await db.select().from(sponsor).where(eq(sponsor.id, id)).limit(1);
	if (!row) throw new SponsorNotFoundError();
	const ships = await db.select().from(sponsorship).where(eq(sponsorship.sponsorId, id));
	return {
		...row,
		sponsorships: ships
			.map((s) => ({ ...s, deadline: sponsorshipDeadline(s, today) }))
			// Newest first; an undated pitch is the newest thing there is.
			.sort((a, b) => (b.startsOn ?? '9').localeCompare(a.startsOn ?? '9'))
	};
}

export type SponsorInput = Omit<NewSponsor, 'id' | 'createdAt' | 'updatedAt'>;

export async function createSponsor(input: SponsorInput): Promise<Sponsor> {
	const [row] = await db.insert(sponsor).values(input).returning();
	return row;
}

export async function updateSponsor(id: string, input: SponsorInput): Promise<void> {
	const rows = await db
		.update(sponsor)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(sponsor.id, id))
		.returning({ id: sponsor.id });
	if (rows.length === 0) throw new SponsorNotFoundError();
}

/** Refused while any sponsorship names it: the history is the point. */
export async function deleteSponsor(id: string): Promise<void> {
	const [used] = await db
		.select({ n: count() })
		.from(sponsorship)
		.where(eq(sponsorship.sponsorId, id));
	const n = Number(used?.n ?? 0);
	if (n > 0) throw new SponsorInUseError(n);

	const rows = await db.delete(sponsor).where(eq(sponsor.id, id)).returning({ id: sponsor.id });
	if (rows.length === 0) throw new SponsorNotFoundError();
}

export type SponsorshipInput = Omit<NewSponsorship, 'id' | 'createdAt' | 'updatedAt'>;

export async function createSponsorship(input: SponsorshipInput): Promise<Sponsorship> {
	const [row] = await db.insert(sponsorship).values(input).returning();
	return row;
}

export async function updateSponsorship(
	id: string,
	input: Omit<SponsorshipInput, 'sponsorId'>
): Promise<void> {
	const rows = await db
		.update(sponsorship)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(sponsorship.id, id))
		.returning({ id: sponsorship.id });
	if (rows.length === 0) throw new SponsorshipNotFoundError();
}

export async function deleteSponsorship(id: string): Promise<void> {
	const rows = await db
		.delete(sponsorship)
		.where(eq(sponsorship.id, id))
		.returning({ id: sponsorship.id });
	if (rows.length === 0) throw new SponsorshipNotFoundError();
}
