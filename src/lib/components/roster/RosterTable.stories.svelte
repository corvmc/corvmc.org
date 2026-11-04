<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import RosterTable from './RosterTable.svelte';
	import CopyEmailsButton from './CopyEmailsButton.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import type { RosterPerson } from '#lib/types/roster.js';

	const { Story } = defineMeta({
		title: 'Roster/RosterTable',
		tags: ['autodocs'],
		parameters: {
			layout: 'padded',
			docs: {
				description: {
					component:
						"A roster's rows without the toolbar, for a short list inside a card: " +
						'person and email first, then the page’s own cells.'
				}
			}
		}
	});

	type Row = RosterPerson & { status: 'active' | 'pending'; position: string | null };

	const person = (id: string, name: string, position: string | null, pending = false): Row => ({
		personId: id,
		member: {
			type: 'member',
			id,
			title: name,
			subtitle: position ?? `${id}@example.com`,
			subtype: null
		},
		email: `${id}@example.com`,
		memberStatus: 'member',
		status: pending ? 'pending' : 'active',
		position
	});

	const rows = [
		person('skyler', 'Skyler Santos', 'Chair'),
		person('taylor', 'Taylor Chen', null),
		person('sage', 'Sage Kim', null, true)
	];
</script>

<Story name="In a card">
	<div class="@container">
		<InfoCard title="Roster">
			{#snippet action()}
				<CopyEmailsButton emails={rows.map((r) => r.email)} />
			{/snippet}
			<RosterTable {rows} personLabel="Member">
				{#snippet lead(row)}<StatusBadge status={row.status} />{/snippet}
				{#snippet columns()}
					<th class="w-px">Status</th>
				{/snippet}
				{#snippet cells(row)}
					<td class="w-px">{row.status}</td>
				{/snippet}
			</RosterTable>
		</InfoCard>
	</div>
</Story>
