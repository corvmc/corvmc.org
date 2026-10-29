<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Roster from './Roster.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import type { RosterPerson } from '$lib/types/roster';
	import type { RosterState } from './roster-state.svelte';

	const { Story } = defineMeta({
		title: 'Roster/Roster',
		// No `component:`: each story renders its own, as DataList's do.
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						'A list of people. Search, paging, Clear, export, "Copy emails" and the ' +
						"side panel are the roster's; the query, filters and columns are the page's."
				}
			}
		}
	});

	type Row = RosterPerson & { hours: number };

	const person = (id: string, name: string, sustaining = false): Row => ({
		personId: id,
		member: {
			type: 'member',
			id,
			title: name,
			subtitle: `${id}@example.com`,
			subtype: sustaining ? 'sustaining' : null
		},
		email: `${id}@example.com`,
		memberStatus: sustaining ? 'sustaining' : 'member',
		hours: id.length
	});

	const rows = [
		person('skyler', 'Skyler Santos', true),
		person('taylor', 'Taylor Chen'),
		person('sage', 'Sage Kim')
	];

	const result = Promise.resolve({
		rows,
		pagination: { page: 1, pageSize: 50, total: 3, totalPages: 1 }
	});

	// `rosterState()` reads the URL; a story has none worth reading.
	const roster: RosterState<Record<string, unknown>> = {
		values: { q: '', page: 1 },
		activeCount: 0,
		clear() {},
		query: ''
	};
</script>

<Story name="With columns and panel">
	<div class="@container">
		<Roster
			{roster}
			{result}
			exportPath="/staff/volunteer/people/export"
			emails={async () => rows.map((r) => r.email!)}
		>
			{#snippet columns()}
				<th class="col-support cell-num">Hours</th>
			{/snippet}
			{#snippet cells(row)}
				<td class="col-support cell-num">{row.hours}</td>
			{/snippet}
			{#snippet panel(row, ctl)}
				<Modal bind:open={ctl.open} title={row.member.title} placement="end">
					{row.email}
				</Modal>
			{/snippet}
		</Roster>
	</div>
</Story>

<Story name="Bare">
	<div class="@container">
		<Roster {roster} {result} />
	</div>
</Story>
