import { describe, expect, it } from 'vitest';

// The panels render on the server (#3158), but an `{#await}` block sends its pending
// branch, and `Latest` resolves in an effect the server never runs. Either way the
// server sends a placeholder that hydration replaces (#3183), as does a boundary's
// `pending` snippet. Page content is awaited instead: in the script, the template,
// or as `latest.current ?? (await first)`.
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
	'./routes/staff/inbox/daily/SessionSummary.svelte',
	// A row's record panel, and the forms of a dialog or an edit mode.
	'./routes/staff/members/[id]/MemberRecordPanel.svelte',
	'./lib/components/groups/GroupRecordPanel.svelte',
	'./routes/staff/reservations/CreateModal.svelte',
	'./lib/components/events/CreateEventModal.svelte',
	'./lib/components/events/ListingEditForm.svelte',
	'./lib/components/reservations/ConflictWarnings.svelte',
	'./lib/components/actions/CreateLoanAction.svelte',
	'./lib/components/actions/CheckOutKitAction.svelte'
];

// Below the fold on purpose: a `pending` snippet keeps each off the server render, so
// the page does not wait for it. A record's history feed can be long, and the U-tec
// reads are a third party's latency (#3144).
const DEFERRED = [
	'./lib/components/ui/ActivityFeed/ActivityFeedCard.svelte',
	'./routes/staff/reservations/settings/building-access/LockSettings.svelte'
];

/** Template only: scripts and HTML comments may name `{#await}` without using one. */
const template = (source: string) =>
	source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const rendersPending = (file: string) =>
	/\{#await\b|\{#snippet pending\b/.test(template(sources[file])) ||
	(/new Latest\(/.test(sources[file]) && !/\.current \?\? \(await\b/.test(sources[file]));

// A snippet assigned from a component's script is handed to some other component to
// draw. The server runs no effects, and a layout has already rendered by the time its
// page's script runs, so whatever draws it adds it after hydration (#3217). Pass a
// snippet as a prop, or have the drawing component read the data itself.
const handsUpSnippet = (source: string) => {
	const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
	return [...template(source).matchAll(/\{#snippet (\w+)/g)].some(([, name]) =>
		new RegExp(`=\\s*${name}\\s*[;)]`).test(script)
	);
};

describe('snippets handed up from a script', () => {
	it('spots the shape', () => {
		const handedUp =
			'<script>$effect(() => { slot.bar = bar; });</script>{#snippet bar()}<b></b>{/snippet}';
		expect(handsUpSnippet(handedUp)).toBe(true);
		expect(handsUpSnippet('<script></script>{#snippet bar()}{/snippet}<X {bar} />')).toBe(false);
	});

	it.each(Object.keys(sources))('%s draws its own snippets', (file) => {
		expect(handsUpSnippet(sources[file])).toBe(false);
	});
});

describe('await blocks under the server-rendered panels', () => {
	it('finds the panel components', () => {
		expect(Object.keys(sources)).toContain('./routes/member/reservations/+page.svelte');
	});

	it.each(
		Object.keys(sources).filter(
			(file) => !file.endsWith('Harness.svelte') && ![...CLIENT_ONLY, ...DEFERRED].includes(file)
		)
	)('%s renders its content on the server', (file) => {
		expect(rendersPending(file)).toBe(false);
	});

	it.each([...CLIENT_ONLY, ...DEFERRED])('%s still needs listing', (file) => {
		expect(rendersPending(file)).toBe(true);
	});
});
