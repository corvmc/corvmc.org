import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type ProgramsNavKey = 'reservations' | 'gear' | 'clubs' | 'music';

/** What CMC offers (#3112). */
export const programs: StaffNavSection = {
	key: 'programs',
	title: 'Programs',
	items: [
		{
			// Reservations (closures a type filter) and Recurring series are its
			// views (#2766); a series' own page lights it too.
			key: 'reservations',
			capability: 'reservation.read',
			label: 'Practice space',
			href: resolve('staff/reservations'),
			also: [resolve('staff/recurring')]
		},
		// Items, Supplies, loans, problems, orders and acquisitions are its lists
		// (#2573, #2767, #3112). The key stays `gear`, which starred rows store.
		{
			key: 'gear',
			capability: 'inventory.read',
			label: 'Equipment',
			href: resolve('staff/inventory')
		},
		// A club is a program staff run with its chairs (#3027).
		{
			key: 'clubs',
			capability: 'group.read',
			label: 'Clubs',
			href: resolve('staff/clubs')
		},
		// The radio's state and every release (#2766); its sales totals are a
		// Reports view and each release's sales are on its panel. `music.read`:
		// the treasurer for the sales, the site moderator for the takedowns.
		{
			key: 'music',
			capability: 'music.read',
			label: 'Music',
			href: resolve('staff/music')
		}
	]
};
