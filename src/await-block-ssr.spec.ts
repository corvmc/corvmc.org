import { describe, expect, it } from 'vitest';

// The panels render on the server (#3158), but an `{#await}` block sends its pending
// branch, and `Latest` resolves in an effect the server never runs. Either way the
// server sends a placeholder that hydration replaces (#3183). Page content is awaited
// instead: in the script, the template, or as `latest.current ?? (await first)`.
const sources = import.meta.glob<string>(
	[
		'./routes/member/**/*.svelte',
		'./routes/staff/**/*.svelte',
		'./routes/band/**/*.svelte',
		'./lib/components/**/*.svelte'
	],
	{ query: '?raw', import: 'default', eager: true }
);

// Content that only exists after a click: a dialog's body, and the fields inside one,
// are not in the server's HTML.
const CLIENT_ONLY = [
	'./lib/components/actions/EditScheduleAction.svelte',
	'./lib/components/events/RepeatEventAction.svelte',
	'./lib/components/groups/SessionAttendanceAction.svelte',
	'./routes/staff/members/[id]/panels/GrantCertificationAction.svelte',
	'./routes/staff/members/[id]/panels/TrainingShiftField.svelte',
	'./routes/staff/members/instructors/GrantInstructorAction.svelte',
	'./routes/staff/members/instructors/TeachingTermsFields.svelte',
	// The inbox filter drawer, and Daily's session and summary: each opens on a click.
	'./routes/staff/inbox/FilterPanel.svelte',
	'./routes/staff/inbox/daily/+page.svelte',
	'./routes/staff/inbox/daily/SessionSummary.svelte'
];

// Not yet converted (#3183). The list only shrinks.
const NOT_YET_CONVERTED = [
	'./routes/member/volunteer/feedback/[signupId]/+page.svelte',
	'./routes/member/volunteer/interests/+page.svelte',
	'./routes/member/volunteer/profile/+page.svelte',
	'./routes/member/volunteer/start/+page.svelte'
];

/** Template only: scripts and HTML comments may name `{#await}` without using one. */
const template = (source: string) =>
	source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const rendersPending = (file: string) =>
	/\{#await\b/.test(template(sources[file])) ||
	(/new Latest\(/.test(sources[file]) && !/\.current \?\? \(await\b/.test(sources[file]));

describe('await blocks under the server-rendered panels', () => {
	it('finds the panel components', () => {
		expect(Object.keys(sources)).toContain('./routes/member/reservations/+page.svelte');
	});

	it.each(
		Object.keys(sources).filter((file) => ![...CLIENT_ONLY, ...NOT_YET_CONVERTED].includes(file))
	)('%s renders its content on the server', (file) => {
		expect(rendersPending(file)).toBe(false);
	});

	it.each([...CLIENT_ONLY, ...NOT_YET_CONVERTED])('%s still needs listing', (file) => {
		expect(rendersPending(file)).toBe(true);
	});
});
