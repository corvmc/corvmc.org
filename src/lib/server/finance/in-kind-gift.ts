import { db } from '#lib/server/db/index.js';
import { financialEntry } from '#lib/server/db/schema/financial.js';
import { project } from '#lib/server/db/schema/project.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { and, desc, eq } from 'drizzle-orm';
import { DomainError } from '#lib/server/domain-error.js';
import type { PartyRef } from '#lib/server/party/activity-service.js';
import type { FeedPage, FeedItem } from '#lib/types/activity.js';
import { clubInstant } from '#lib/utils/format.js';
import { recordEntry } from './financial-entry-service';

/**
 * Goods or services an organization or person gave that are neither stock nor
 * volunteer time (#2727): donated printing, food, a free night at a venue.
 *
 * Filed under the giver as the subject, with `giftId` in the metadata so one
 * gift can be reversed through `reverseEntriesForSubject` without the rest.
 */

export class InKindGiftValidationError extends DomainError {
	readonly httpStatus = 422;
}

export interface InKindGiftInput {
	description: string;
	valueCents: number;
	/** `YYYY-MM-DD`, a club date. */
	occurredOn: string;
	projectId?: string | null;
}

export async function recordInKindGift(
	party: PartyRef,
	input: InKindGiftInput,
	recordedByUserId: string
): Promise<{ giftId: string }> {
	const description = input.description.trim();
	if (!description) throw new InKindGiftValidationError('Say what was given.');
	if (!Number.isInteger(input.valueCents) || input.valueCents <= 0) {
		throw new InKindGiftValidationError('Enter its fair value.');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) {
		throw new InKindGiftValidationError('Pick the day it was given.');
	}
	const projectId = input.projectId || null;
	if (projectId) {
		const [found] = await db
			.select({ id: project.id })
			.from(project)
			.where(eq(project.id, projectId))
			.limit(1);
		if (!found) throw new InKindGiftValidationError('That project no longer exists.');
	}

	const giftId = crypto.randomUUID();
	await recordEntry({
		amountCents: input.valueCents,
		kind: 'in_kind',
		category: 'donation',
		// A day, not a time: noon keeps it inside the day in any reading of the zone.
		occurredAt: clubInstant(input.occurredOn, '12:00'),
		settlement: 'none',
		subjectType: party.type,
		subjectId: party.id,
		projectId,
		recordedByUserId,
		description,
		metadata: { giftId }
	});
	return { giftId };
}

export type GiftFeedItem = FeedItem & { amountCents: number };

/** A party's in-kind gifts for its timeline, newest first, read with `limit + 1`. */
export async function inKindGiftsFor(
	party: PartyRef,
	limit: number
): Promise<FeedPage<GiftFeedItem>> {
	const rows = await db
		.select({
			id: financialEntry.id,
			amountCents: financialEntry.amountCents,
			occurredAt: financialEntry.occurredAt,
			description: financialEntry.description,
			recordedByUserId: financialEntry.recordedByUserId,
			recordedByName: user.name
		})
		.from(financialEntry)
		.leftJoin(user, eq(user.id, financialEntry.recordedByUserId))
		.where(
			and(
				eq(financialEntry.subjectType, party.type),
				eq(financialEntry.subjectId, party.id),
				eq(financialEntry.kind, 'in_kind')
			)
		)
		.orderBy(
			desc(financialEntry.occurredAt),
			desc(financialEntry.createdAt),
			desc(financialEntry.id)
		)
		.limit(limit + 1);
	return {
		items: rows.slice(0, limit).map((r) => ({
			id: `gift:${r.id}`,
			at: r.occurredAt,
			actorId: r.recordedByUserId,
			actorName: r.recordedByName,
			summary: r.description,
			amountCents: r.amountCents
		})),
		hasMore: rows.length > limit
	};
}
