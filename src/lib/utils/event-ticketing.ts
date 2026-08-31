import { formatCents } from './format';
import { TICKET_CONTRIBUTION_MAX_CENTS } from '$lib/config';

/**
 * Who sells the tickets, and what that means for the price.
 *
 * The three ticketing fields on an event are independent:
 *   - `ticketingEnabled` — we sell them through Stripe. Only this mode has a
 *     capacity, a sold count, check-in codes, and the sustaining-member discount.
 *   - `externalTicketUrl` — somebody else sells them (the venue, Eventbrite…).
 *   - `ticketPrice` — what an attendee pays, in cents. It is a *display* price
 *     and applies to all three modes: platform checkout, an off-site seller, or
 *     cash at the door. A null price means free.
 *
 * Reading a missing price as "free" is only correct when nobody is selling
 * tickets, which is why every price label goes through here.
 */
export interface EventTicketing {
	ticketingEnabled: boolean;
	ticketPrice: number | null;
	externalTicketUrl?: string | null;
}

export type TicketingMode = 'platform' | 'external' | 'free';

/** Platform ticketing wins when both are set — that's the checkout we control. */
export function ticketingMode(evt: EventTicketing): TicketingMode {
	if (evt.ticketingEnabled) return 'platform';
	if (evt.externalTicketUrl) return 'external';
	return 'free';
}

/** True when the event costs nothing: no price, and nobody selling tickets. */
export function isFreeEvent(evt: EventTicketing): boolean {
	return !evt.ticketPrice && ticketingMode(evt) !== 'external';
}

export interface PriceDisplay {
	/** What to show as the price. */
	label: string;
	/** Undiscounted price to strike through, or null when there's no discount. */
	wasLabel: string | null;
}

/**
 * The price to show for an event. Sustaining members get half off, but only on
 * tickets we sell — we don't control an outside seller's pricing.
 */
export function priceDisplay(
	evt: EventTicketing,
	opts: { isSustainingMember?: boolean } = {}
): PriceDisplay {
	const discounted = opts.isSustainingMember ? sustainingMemberPrice(evt) : null;
	if (discounted !== null) {
		return { label: formatCents(discounted), wasLabel: formatCents(evt.ticketPrice!) };
	}

	if (evt.ticketPrice && evt.ticketPrice > 0) {
		return { label: formatCents(evt.ticketPrice), wasLabel: null };
	}

	// No price. Off-site sellers set their own, so we can't claim it's free.
	return { label: ticketingMode(evt) === 'external' ? 'See tickets' : 'Free', wasLabel: null };
}

/**
 * Parse a price typed in dollars into whole cents. Returns null for a blank
 * field (no price) and `undefined` for anything that isn't a positive amount,
 * so callers can tell "cleared" apart from "typo".
 */
export function dollarsToCents(input: string | undefined | null): number | null | undefined {
	const raw = (input ?? '').trim().replace(/^\$/, '');
	if (raw === '') return null;
	const dollars = Number(raw);
	if (!Number.isFinite(dollars) || dollars <= 0) return undefined;
	return Math.round(dollars * 100);
}

/**
 * Parse the optional contribution a ticket buyer adds on top of the price.
 *
 * Not `dollarsToCents`: that one reads a typed `0` as a typo, which is exactly
 * what someone means here when they change their mind about giving. Blank and
 * zero are both "no gift"; only junk, a negative, or an implausible amount are
 * errors, so callers can tell "didn't give" apart from "fat-fingered it".
 */
export function contributionToCents(input: string | null | undefined): number | undefined {
	const raw = (input ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
	if (raw === '') return 0;
	const dollars = Number(raw);
	if (!Number.isFinite(dollars) || dollars < 0) return undefined;
	const cents = Math.round(dollars * 100);
	if (cents > TICKET_CONTRIBUTION_MAX_CENTS) return undefined;
	return cents;
}

/** The half-price sustaining-member rate, or null where the discount doesn't apply. */
export function sustainingMemberPrice(evt: EventTicketing): number | null {
	if (ticketingMode(evt) !== 'platform') return null;
	if (!evt.ticketPrice || evt.ticketPrice <= 0) return null;
	return Math.round(evt.ticketPrice / 2);
}
