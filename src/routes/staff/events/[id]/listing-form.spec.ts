import { describe, expect, it } from 'vitest';
import {
	centsOf,
	initialTickets,
	initialWhere,
	shiftTime,
	ticketPosts,
	wherePosts,
	type WhereState
} from './listing-form';

const venues = [
	{ id: 'room', isPrimary: true },
	{ id: 'riverfront', isPrimary: false }
];
const blank = { venueId: null, location: null, address: null };

describe('initialWhere', () => {
	it('is a saved venue when the venue is not the practice room', () => {
		expect(initialWhere({ ...blank, venueId: 'riverfront' }, false, venues)).toBe('venue');
	});

	it('is the practice space for a hold, whatever text is typed', () => {
		expect(initialWhere({ ...blank, location: 'Bombs Away' }, true, venues)).toBe('room');
	});

	it('is the practice space when the venue is the room itself', () => {
		expect(initialWhere({ ...blank, venueId: 'room' }, false, venues)).toBe('room');
	});

	it('is somewhere else for typed text with no venue and no hold', () => {
		expect(initialWhere({ ...blank, location: 'Bombs Away' }, false, venues)).toBe('other');
		expect(initialWhere({ ...blank, address: '2527 NW Monroe' }, false, venues)).toBe('other');
	});

	it('is the practice space when nothing is stored', () => {
		expect(initialWhere(blank, false, venues)).toBe('room');
		expect(initialWhere({ ...blank, location: '  ' }, false, venues)).toBe('room');
	});
});

describe('initialTickets', () => {
	const sale = {
		source: 'cmc',
		ticketingEnabled: false,
		externalTicketUrl: null,
		ticketPrice: null,
		ticketPriceFloorCents: null
	};

	it('reads our own sale as cmc, and anyone else’s as the band’s', () => {
		expect(initialTickets({ ...sale, ticketingEnabled: true })).toBe('cmc');
		expect(initialTickets({ ...sale, source: 'band', ticketingEnabled: true })).toBe('band');
	});

	it('reads a link or a stated price as a link, so saving cannot clear them', () => {
		expect(initialTickets({ ...sale, externalTicketUrl: 'https://x.test' })).toBe('link');
		expect(initialTickets({ ...sale, ticketPrice: 1500 })).toBe('link');
		expect(initialTickets({ ...sale, ticketPriceFloorCents: 500 })).toBe('link');
	});

	it('is none otherwise', () => {
		expect(initialTickets(sale)).toBe('none');
	});
});

describe('ticketPosts', () => {
	const values = { externalTicketUrl: 'https://x.test', price: '15', floor: '5', quantity: '80' };

	it.each(['none', 'link', 'cmc', 'band'] as const)(
		'never posts ticketingEnabled for a listing CMC does not sell (%s)',
		(choice) => {
			for (const source of ['band', 'community', 'group']) {
				expect(ticketPosts(choice, source, values)).not.toHaveProperty('ticketingEnabled');
			}
		}
	);

	it('posts nothing for a band’s own sale', () => {
		expect(ticketPosts('band', 'band', values)).toEqual({});
	});

	it('posts the sale for cmc, and clears the link', () => {
		expect(ticketPosts('cmc', 'cmc', values)).toEqual({
			ticketingEnabled: true,
			externalTicketUrl: '',
			ticketPrice: '1500',
			ticketPriceFloorCents: '500',
			ticketQuantity: '80'
		});
	});

	it('closes our own sale for a link or none', () => {
		expect(ticketPosts('link', 'cmc', values)).toMatchObject({
			ticketingEnabled: false,
			externalTicketUrl: 'https://x.test',
			ticketPrice: '1500'
		});
		expect(ticketPosts('none', 'cmc', values)).toEqual({
			ticketingEnabled: false,
			externalTicketUrl: '',
			ticketPrice: '',
			ticketPriceFloorCents: ''
		});
	});

	it('does not offer cmc to a listing CMC does not sell', () => {
		expect(ticketPosts('cmc', 'community', values)).toEqual({});
	});
});

describe('wherePosts', () => {
	const state: WhereState = {
		venueId: 'riverfront',
		hasHold: false,
		cancelled: false,
		releasing: false,
		holdWanted: false,
		holdStart: '',
		holdEnd: ''
	};

	it('posts a blank venue for the practice space, and no place', () => {
		expect(wherePosts('room', state)).toEqual({
			venueId: '',
			postsPlace: false,
			releaseHold: false,
			rebookReservation: false
		});
	});

	it('holds the room only when a hold is wanted and both times are filled', () => {
		const wanted = { ...state, holdWanted: true };
		expect(wherePosts('room', wanted).rebookReservation).toBe(false);
		expect(wherePosts('room', { ...wanted, holdStart: '18:00' }).rebookReservation).toBe(false);
		expect(
			wherePosts('room', { ...wanted, holdStart: '18:00', holdEnd: '23:00' }).rebookReservation
		).toBe(true);
	});

	it('releases the hold on Save when Release hold is staged, and writes no window', () => {
		const staged = {
			...state,
			hasHold: true,
			releasing: true,
			holdWanted: true,
			holdStart: '18:00',
			holdEnd: '23:00'
		};
		expect(wherePosts('room', staged)).toMatchObject({
			releaseHold: true,
			rebookReservation: false
		});
		expect(wherePosts('room', { ...staged, cancelled: true }).releaseHold).toBe(false);
		expect(wherePosts('room', { ...staged, hasHold: false }).releaseHold).toBe(false);
	});

	it('posts the picked venue and no place for a saved venue', () => {
		expect(wherePosts('venue', state)).toMatchObject({
			venueId: 'riverfront',
			postsPlace: false,
			rebookReservation: false
		});
	});

	it('posts a blank venue and the typed place for somewhere else', () => {
		expect(wherePosts('other', state)).toMatchObject({ venueId: '', postsPlace: true });
	});

	it.each(['venue', 'other'] as const)('releases the hold when %s leaves the room', (choice) => {
		expect(wherePosts(choice, { ...state, hasHold: true }).releaseHold).toBe(true);
		expect(wherePosts(choice, state).releaseHold).toBe(false);
	});

	it('touches no hold on a cancelled event', () => {
		const cancelled = {
			...state,
			cancelled: true,
			hasHold: true,
			holdWanted: true,
			holdStart: '18:00',
			holdEnd: '23:00'
		};
		expect(wherePosts('room', cancelled).rebookReservation).toBe(false);
		expect(wherePosts('other', cancelled).releaseHold).toBe(false);
	});
});

describe('centsOf and shiftTime', () => {
	it('turns dollars into cents and keeps blank blank', () => {
		expect(centsOf('15.00')).toBe('1500');
		expect(centsOf('0.1')).toBe('10');
		expect(centsOf('')).toBe('');
		expect(centsOf('abc')).toBe('');
	});

	it('shifts a time across midnight', () => {
		expect(shiftTime('23:00', 120)).toBe('01:00');
		expect(shiftTime('01:00', -120)).toBe('23:00');
	});
});
