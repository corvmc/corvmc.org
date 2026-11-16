import type { PartyRef } from './activity-service';

/** One string per party, so organizations and people share a map without colliding. */
export const partyKey = (party: PartyRef): string => `${party.type}:${party.id}`;

/**
 * The key two names match on for Possible duplicates: case, punctuation and
 * spacing ignored. People and organizations both group by it.
 */
export function nameKey(name: string | null | undefined): string | null {
	const key = name
		?.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
	return key || null;
}

const BUSINESS_SUFFIX = /\s(co|company|inc|llc|ltd|corp)$/;

/** `nameKey` with a trailing "Co.", "Inc." or "LLC" dropped: "Willamette Honey Co." is "willamette honey". */
export function organizationNameKey(name: string | null | undefined): string | null {
	const key = nameKey(name);
	return key ? key.replace(BUSINESS_SUFFIX, '') || key : null;
}
