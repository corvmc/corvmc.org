import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type GovernanceNavKey =
	'projects' | 'volunteer-schedule' | 'committees' | 'incidents' | 'suggestions' | 'ballots';

/** How CMC runs itself (#3112). */
export const governance: StaffNavSection = {
	key: 'governance',
	title: 'Governance',
	items: [
		// Every task, with Projects as a view (#2625) and recurring work and
		// templates as its settings (#2767). The key stays `projects`, which
		// starred rows store.
		{
			key: 'projects',
			capability: 'project.read',
			label: 'Tasks',
			href: resolve('staff/tasks')
		},
		// Shift control (#2625): signing people up and closing shifts out. It
		// keeps the rest of `/staff/volunteer` (roles, clearances) and the key
		// `volunteer-schedule`, which starred rows store.
		{
			key: 'volunteer-schedule',
			capability: 'volunteer.read',
			label: 'Shifts',
			href: resolve('staff/volunteering'),
			also: [resolve('staff/volunteer')],
			badgeKey: 'volunteerPending'
		},
		// Committees work as departments (#2983), listed apart (#3027).
		{
			key: 'committees',
			capability: 'committee.manage',
			alsoFor: ['committee.reviewApplications'],
			label: 'Committees',
			href: resolve('staff/committees')
		},
		// Building and safety reports, not member posts (#3112).
		{
			key: 'incidents',
			capability: 'incident.read',
			label: 'Incidents',
			href: resolve('staff/incidents')
		},
		{
			key: 'suggestions',
			capability: 'suggestion.read',
			label: 'Suggestions',
			href: resolve('staff/suggestions')
		},
		{
			key: 'ballots',
			capability: 'ballot.manage',
			surface: 'ballots',
			label: 'Ballots',
			href: resolve('staff/ballots')
		}
	]
};
