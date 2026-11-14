import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type ProgramsNavKey = 'calendar' | 'reservations' | 'music';

export const programs: StaffNavSection = {
	key: 'programs',
	title: 'Programs',
	items: [
		// Every listing, with Productions, Venues and vendor applications as views
		// (#2766). A venue's own page stays under `/staff/venues` and lights this row.
		{
			key: 'calendar',
			capability: 'event.read',
			label: 'Events',
			href: resolve('staff/events'),
			also: [resolve('staff/venues')]
		},
		{
			// Reservations (closures a type filter), Recurring series and Building
			// access are its views (#2766); a series' own page lights it too.
			key: 'reservations',
			capability: 'reservation.read',
			label: 'Practice space',
			href: resolve('staff/reservations'),
			also: [resolve('staff/recurring'), resolve('staff/building-access')]
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
