import { describe, expect, it } from 'vitest';

// The panels render on the server (#3158), but an `{#await}` block sends its pending
// branch, not its result, and hydration then replaces it (#3183). Page content is
// awaited in the script, or comes from the page's load-bearing query, instead.
const sources = import.meta.glob<string>(
	[
		'./routes/member/**/*.svelte',
		'./routes/staff/**/*.svelte',
		'./routes/band/**/*.svelte',
		'./lib/components/**/*.svelte'
	],
	{ query: '?raw', import: 'default', eager: true }
);

// Content that only exists after a click: a dialog's body is not in the server's HTML.
const CLIENT_ONLY = [
	'./lib/components/actions/EditScheduleAction.svelte',
	'./lib/components/events/RepeatEventAction.svelte',
	'./lib/components/groups/SessionAttendanceAction.svelte',
	'./routes/staff/members/instructors/GrantInstructorAction.svelte'
];

// Not yet converted (#3183). The list only shrinks.
const NOT_YET_CONVERTED = [
	'./lib/components/roster/Roster.svelte',
	'./lib/components/ui/entity/RelatedList.svelte',
	'./routes/member/groups/[slug]/CommitteeNumbers.svelte',
	'./routes/member/messages/+page.svelte',
	'./routes/member/profile/TeachingCard.svelte',
	'./routes/member/profile/teaching/apply/+page.svelte',
	'./routes/staff/inbox/+page.svelte',
	'./routes/staff/inbox/FilterPanel.svelte',
	'./routes/staff/inbox/InboxToolbar.svelte',
	'./routes/staff/inbox/SavedViewTabs.svelte',
	'./routes/staff/inbox/[id]/DetailsPanel.svelte',
	'./routes/staff/inbox/daily/+page.svelte',
	'./routes/staff/inbox/daily/SessionSummary.svelte',
	'./routes/staff/members/TeacherRoster.svelte',
	'./routes/staff/members/VolunteerRoster.svelte',
	'./routes/staff/reports/volunteering/+page.svelte',
	'./routes/staff/reservations/ReservationCard.svelte',
	'./routes/staff/reservations/ReservationList.svelte',
	'./routes/staff/reservations/settings/building-access/LockCodes.svelte',
	'./routes/staff/suggestions/+page.svelte',
	'./routes/staff/volunteer/roles/[id]/RoleInterestedCard.svelte'
];

/** Template only: scripts and HTML comments may name `{#await}` without using one. */
const template = (source: string) =>
	source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const usesAwaitBlock = (file: string) => /\{#await\b/.test(template(sources[file]));

describe('await blocks under the server-rendered panels', () => {
	it('finds the panel components', () => {
		expect(Object.keys(sources)).toContain('./routes/member/reservations/+page.svelte');
	});

	it.each(
		Object.keys(sources).filter((file) => ![...CLIENT_ONLY, ...NOT_YET_CONVERTED].includes(file))
	)('%s renders its content on the server', (file) => {
		expect(usesAwaitBlock(file)).toBe(false);
	});

	it.each([...CLIENT_ONLY, ...NOT_YET_CONVERTED])('%s still needs listing', (file) => {
		expect(usesAwaitBlock(file)).toBe(true);
	});
});
