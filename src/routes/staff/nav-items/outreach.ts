import { resolve } from '$app/paths';
import type { StaffNavSection } from './types';

export type OutreachNavKey = 'inbox' | 'contacts' | 'funding' | 'outreach' | 'content';

/** Outward: the public and outside parties (#3112). */
export const outreach: StaffNavSection = {
	key: 'outreach',
	title: 'Outreach',
	items: [
		// Channels is its settings view (#2763).
		{
			key: 'inbox',
			capability: 'inbox.read',
			label: 'Inbox',
			href: resolve('staff/inbox'),
			badgeKey: 'inboxUnread'
		},
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
		// Grant applications and sponsorships on one list (#2622). A grant's page
		// is its record; a sponsorship opens on its sponsor's Contacts page.
		{
			key: 'funding',
			capability: 'grant.read',
			alsoFor: ['sponsor.read'],
			label: 'Funding',
			href: resolve('staff/funding'),
			also: [resolve('staff/grants')]
		},
		// Campaigns and Audiences are its views, each with its own gate (#2394).
		// The key stays `outreach`, which starred rows store.
		{
			key: 'outreach',
			capability: 'marketing.read',
			alsoFor: ['marketing.manageAudiences'],
			label: 'Marketing',
			href: resolve('staff/marketing')
		},
		// Opens the Content panel (#3119); its rows are `contentNavItems`.
		{
			key: 'content',
			capability: 'help.read',
			alsoFor: ['localResource.manage'],
			label: 'Content',
			href: resolve('staff/content'),
			also: [resolve('staff/help'), resolve('staff/local-resources')]
		}
	]
};
