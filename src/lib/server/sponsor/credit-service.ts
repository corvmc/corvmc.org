import { db } from '$lib/server/db';
import { sponsor, sponsorship, sponsorPlacement } from '$lib/server/db/schema/sponsor';
import { eventListing } from '$lib/server/db/schema/event';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { and, desc, eq } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { uploadFile } from '$lib/server/storage';
import { mediaKey } from '$lib/server/storage-keys';
import { detachSlot, replaceSlot } from '$lib/server/media/media-service';
import { creditedSponsorshipStatuses, type SponsorshipStatus } from '$lib/config';
import { SponsorNotFoundError, SponsorshipNotFoundError } from './sponsor-service';

export class PlacementEmptyError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Credit them somewhere: on the event page, in its emails, or both.');
	}
}

export class PlacementNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Placement not found');
	}
}

export class PlacementEventNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Event not found');
	}
}

/** Where a credit appears: the public event page, or a blast about the event. */
export type CreditSurface = 'eventPage' | 'campaign';

type CreditRow = {
	sponsorId: string;
	name: string;
	website: string | null;
	status: SponsorshipStatus;
	onEventPage: boolean;
	inCampaign: boolean;
	logoKey: string | null;
};

export type SponsorCredit = Pick<CreditRow, 'sponsorId' | 'name' | 'website' | 'logoKey'>;

/** Who an event credits on one surface: a deal that happened, each sponsor once. */
export function toCredits(rows: CreditRow[], surface: CreditSurface): SponsorCredit[] {
	const credited = new Map<string, SponsorCredit>();
	for (const r of rows) {
		if (!(creditedSponsorshipStatuses as readonly string[]).includes(r.status)) continue;
		if (!(surface === 'eventPage' ? r.onEventPage : r.inCampaign)) continue;
		if (credited.has(r.sponsorId)) continue;
		credited.set(r.sponsorId, {
			sponsorId: r.sponsorId,
			name: r.name,
			website: r.website,
			logoKey: r.logoKey
		});
	}
	return [...credited.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function creditsForEvent(
	eventId: string,
	surface: CreditSurface
): Promise<SponsorCredit[]> {
	const rows = await db
		.select({
			sponsorId: sponsor.id,
			name: sponsor.name,
			website: sponsor.website,
			status: sponsorship.status,
			onEventPage: sponsorPlacement.onEventPage,
			inCampaign: sponsorPlacement.inCampaign,
			logoKey: media.key
		})
		.from(sponsorPlacement)
		.innerJoin(sponsorship, eq(sponsorship.id, sponsorPlacement.sponsorshipId))
		.innerJoin(sponsor, eq(sponsor.id, sponsorship.sponsorId))
		.leftJoin(
			mediaAttachment,
			and(
				eq(mediaAttachment.attachableType, 'sponsor'),
				eq(mediaAttachment.attachableId, sponsor.id),
				eq(mediaAttachment.slot, 'logo')
			)
		)
		.leftJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(eq(sponsorPlacement.eventId, eventId));
	return toCredits(rows, surface);
}

/** Every event a sponsor's terms are placed on, newest show first. */
export async function listPlacementsForSponsor(sponsorId: string) {
	return db
		.select({
			id: sponsorPlacement.id,
			sponsorshipId: sponsorPlacement.sponsorshipId,
			sponsorshipTitle: sponsorship.title,
			eventId: eventListing.id,
			eventTitle: eventListing.title,
			startsAt: eventListing.startsAt,
			onEventPage: sponsorPlacement.onEventPage,
			inCampaign: sponsorPlacement.inCampaign
		})
		.from(sponsorPlacement)
		.innerJoin(sponsorship, eq(sponsorship.id, sponsorPlacement.sponsorshipId))
		.innerJoin(eventListing, eq(eventListing.id, sponsorPlacement.eventId))
		.where(eq(sponsorship.sponsorId, sponsorId))
		.orderBy(desc(eventListing.startsAt));
}

export type PlacementInput = {
	sponsorshipId: string;
	eventId: string;
	onEventPage: boolean;
	inCampaign: boolean;
};

/** Placing the same term on the same event again changes where it is credited. */
export async function placeSponsorship(input: PlacementInput): Promise<void> {
	if (!input.onEventPage && !input.inCampaign) throw new PlacementEmptyError();

	const [[ship], [evt]] = await Promise.all([
		db
			.select({ id: sponsorship.id })
			.from(sponsorship)
			.where(eq(sponsorship.id, input.sponsorshipId))
			.limit(1),
		db
			.select({ id: eventListing.id })
			.from(eventListing)
			.where(eq(eventListing.id, input.eventId))
			.limit(1)
	]);
	if (!ship) throw new SponsorshipNotFoundError();
	if (!evt) throw new PlacementEventNotFoundError();

	await db
		.insert(sponsorPlacement)
		.values(input)
		.onConflictDoUpdate({
			target: [sponsorPlacement.sponsorshipId, sponsorPlacement.eventId],
			set: { onEventPage: input.onEventPage, inCampaign: input.inCampaign }
		});
}

export async function removePlacement(id: string): Promise<void> {
	const rows = await db
		.delete(sponsorPlacement)
		.where(eq(sponsorPlacement.id, id))
		.returning({ id: sponsorPlacement.id });
	if (rows.length === 0) throw new PlacementNotFoundError();
}

/** The object key of a sponsor's logo, or null. */
export async function sponsorLogoKey(sponsorId: string): Promise<string | null> {
	const [row] = await db
		.select({ key: media.key })
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(
			and(
				eq(mediaAttachment.attachableType, 'sponsor'),
				eq(mediaAttachment.attachableId, sponsorId),
				eq(mediaAttachment.slot, 'logo')
			)
		)
		.limit(1);
	return row?.key ?? null;
}

export async function setSponsorLogo(
	sponsorId: string,
	file: { buffer: ArrayBuffer; contentType: string; filename: string | null },
	uploadedByUserId: string
): Promise<void> {
	const [row] = await db
		.select({ id: sponsor.id })
		.from(sponsor)
		.where(eq(sponsor.id, sponsorId))
		.limit(1);
	if (!row) throw new SponsorNotFoundError();

	const key = mediaKey('sponsors/logos', sponsorId, file.contentType);
	await uploadFile(file.buffer, key, file.contentType);
	await replaceSlot({
		attachableType: 'sponsor',
		attachableId: sponsorId,
		slot: 'logo',
		key,
		contentType: file.contentType,
		byteSize: file.buffer.byteLength,
		filename: file.filename,
		uploadedByUserId
	});
}

export async function removeSponsorLogo(sponsorId: string): Promise<void> {
	await detachSlot('sponsor', sponsorId, 'logo');
}
