import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type RelationshipsNavKey = 'contacts' | 'outreach' | 'funding';

export const relationships: StaffNavSection = {
	key: 'relationships',
	title: 'Relationships',
	items: [
		// Every outside organization (#2622). Contractors, funders and sponsors
		// are its role views and sections (#2764); a role's capability opens them.
		{
			key: 'contacts',
			capability: 'contact.read',
			alsoFor: ['sponsor.read', 'grant.read', 'contractor.read'],
			label: 'Contacts',
			href: resolve('staff/contacts'),
			also: [resolve('staff/contractors'), resolve('staff/sponsors')]
		},
		// Campaigns and Audiences are its views, each with its own gate (#2394).
		{
			key: 'outreach',
			capability: 'marketing.read',
			alsoFor: ['marketing.manageAudiences'],
			label: 'Outreach',
			href: resolve('staff/marketing')
		},
		// Grant applications and sponsorships on one list (#2622). A grant's page
		// is its record; a sponsorship opens on its sponsor's Contacts page.
		{
			key: 'funding',
			capability: 'grant.read',
			alsoFor: ['sponsor.read'],
			label: 'Funding',
			href: resolve('staff/funding'),
			also: [resolve('staff/grants')]
		}
	]
};
