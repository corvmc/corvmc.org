import { describe, it, expect } from 'vitest';
import {
	ticketingMode,
	isFreeEvent,
	priceDisplay,
	sustainingMemberPrice,
	contributionToCents
} from './event-ticketing';

// Regression: `ticketPrice` used to be meaningful only when `ticketingEnabled`
// was on, so every price renderer read "no platform ticketing" as "free" — an
// externally ticketed $15 show advertised itself as Free with a Get Tickets link
// pointing at an outside seller.

const platform = { ticketingEnabled: true, ticketPrice: 1500, externalTicketUrl: null };
const platformFree = { ticketingEnabled: true, ticketPrice: null, externalTicketUrl: null };
const external = {
	ticketingEnabled: false,
	ticketPrice: 1500,
	externalTicketUrl: 'https://venue.test/tickets'
};
const externalNoPrice = {
	ticketingEnabled: false,
	ticketPrice: null,
	externalTicketUrl: 'https://venue.test/tickets'
};
const door = { ticketingEnabled: false, ticketPrice: 1000, externalTicketUrl: null };
const free = { ticketingEnabled: false, ticketPrice: null, externalTicketUrl: null };

describe('ticketingMode', () => {
	it('reads each combination of the three fields', () => {
		expect(ticketingMode(platform)).toBe('platform');
		expect(ticketingMode(platformFree)).toBe('platform');
		expect(ticketingMode(external)).toBe('external');
		expect(ticketingMode(externalNoPrice)).toBe('external');
		expect(ticketingMode(door)).toBe('free');
		expect(ticketingMode(free)).toBe('free');
	});

	it('prefers our own checkout when an event has both', () => {
		expect(ticketingMode({ ...platform, externalTicketUrl: 'https://venue.test/tickets' })).toBe(
			'platform'
		);
	});
});

describe('isFreeEvent', () => {
	it('is free only with no price and no seller', () => {
		expect(isFreeEvent(free)).toBe(true);
		expect(isFreeEvent(platformFree)).toBe(true);
		expect(isFreeEvent(door)).toBe(false);
		expect(isFreeEvent(external)).toBe(false);
	});

	it('does not call an external event free just because we have no price for it', () => {
		expect(isFreeEvent(externalNoPrice)).toBe(false);
	});
});

describe('priceDisplay', () => {
	it('shows the price whoever is selling', () => {
		expect(priceDisplay(platform).label).toBe('$15.00');
		expect(priceDisplay(external).label).toBe('$15.00');
		expect(priceDisplay(door).label).toBe('$10.00');
	});

	it('says Free only when the event is actually free', () => {
		expect(priceDisplay(free).label).toBe('Free');
		expect(priceDisplay(platformFree).label).toBe('Free');
	});

	it('points at the seller when an external price is unknown', () => {
		expect(priceDisplay(externalNoPrice).label).toBe('See tickets');
	});

	it('halves the price for sustaining members on tickets we sell', () => {
		expect(priceDisplay(platform, { isSustainingMember: true })).toEqual({
			label: '$7.50',
			wasLabel: '$15.00'
		});
	});

	it("does not discount an outside seller's price", () => {
		expect(priceDisplay(external, { isSustainingMember: true })).toEqual({
			label: '$15.00',
			wasLabel: null
		});
		expect(priceDisplay(door, { isSustainingMember: true })).toEqual({
			label: '$10.00',
			wasLabel: null
		});
	});
});

describe('sustainingMemberPrice', () => {
	it('applies to platform tickets only', () => {
		expect(sustainingMemberPrice(platform)).toBe(750);
		expect(sustainingMemberPrice(external)).toBeNull();
		expect(sustainingMemberPrice(door)).toBeNull();
		expect(sustainingMemberPrice(platformFree)).toBeNull();
	});
});

describe('contributionToCents', () => {
	it('reads a blank field and an explicit zero as no contribution', () => {
		// Both mean "I'm not giving today" — only one of them is a mistake, and
		// neither is. dollarsToCents can't be reused because it calls 0 a typo.
		expect(contributionToCents('')).toBe(0);
		expect(contributionToCents('   ')).toBe(0);
		expect(contributionToCents(null)).toBe(0);
		expect(contributionToCents(undefined)).toBe(0);
		expect(contributionToCents('0')).toBe(0);
	});

	it('parses dollars into whole cents', () => {
		expect(contributionToCents('5')).toBe(500);
		expect(contributionToCents('$12.50')).toBe(1250);
		expect(contributionToCents('1,000')).toBe(100000);
		expect(contributionToCents('7.005')).toBe(701);
	});

	it('rejects what is not a gift', () => {
		expect(contributionToCents('abc')).toBeUndefined();
		expect(contributionToCents('-1')).toBeUndefined();
	});

	it('rejects an implausible amount as a typo rather than charging it', () => {
		expect(contributionToCents('1000')).toBe(100000);
		expect(contributionToCents('1000.01')).toBeUndefined();
		expect(contributionToCents('100000')).toBeUndefined();
	});
});
