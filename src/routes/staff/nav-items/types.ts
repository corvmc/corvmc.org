import type { Capability, Surface } from '#lib/config.js';
import type { NavNode } from '#lib/components/layout/Nav/active-nav.js';
import type { TopNavKey } from './top';
import type { OutreachNavKey } from './outreach';
import type { CommunityNavKey } from './community';
import type { ProgramsNavKey } from './programs';
import type { GovernanceNavKey } from './governance';
import type { BottomNavKey } from './bottom';
import type { SystemNavKey } from './system';

/** Each file in this folder names its own keys, so adding a row edits only that file. */
export type StaffNavKey =
	| TopNavKey
	| OutreachNavKey
	| CommunityNavKey
	| ProgramsNavKey
	| GovernanceNavKey
	| BottomNavKey
	| SystemNavKey;

/** The four sections (#3112). Reports and System sit below them, outside any section. */
export type StaffNavSectionKey = 'outreach' | 'community' | 'programs' | 'governance';

/**
 * Field names on `getStaffLayout()`'s return. Items name a count rather than
 * carrying one so the nav can stay a `const`: a badge changes a rendered
 * integer, never which rows exist, and rebuilding the array on every poll
 * would churn every `{#each}` for nothing.
 */
export type StaffNavBadgeKey = 'inboxUnread' | 'volunteerPending' | 'reviewWaiting';

export interface StaffNavItem extends NavNode<StaffNavKey> {
	label: string;
	badgeKey?: StaffNavBadgeKey;
	/**
	 * What the viewer must hold for this row to be worth showing. Omitted on
	 * rows every position can use — the dashboard, and nothing else so far.
	 */
	capability?: Capability;
	/** Further capabilities that each also show the row, for a page with per-view gates. */
	alsoFor?: readonly Capability[];
	/** A surface switched off in code drops the row for everyone (#2116). */
	surface?: Surface;
	/** Present ⇒ the layout renders this row as a `Nav.Collapsible`. */
	children?: StaffNavItem[];
}

export interface StaffNavSection {
	/** Stable id. The persisted collapse record keys off this, never the title. */
	key: StaffNavSectionKey;
	title: string;
	items: StaffNavItem[];
}
