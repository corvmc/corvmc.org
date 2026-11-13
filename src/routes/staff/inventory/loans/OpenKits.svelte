<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { getKitLoans } from '#lib/remote/kit-loans.remote.js';

	const kits = $derived(await getKitLoans());
	const now = new Date();
</script>

{#if kits.length > 0}
	<InfoCard title={m.staff_inventory_kits_open_title()} class="mb-6">
		<Table>
			{#snippet head()}
				<th>{m.staff_location_label()}</th>
				<th>{m.staff_member_label()}</th>
				<th class="whitespace-nowrap">{m.staff_due_label()}</th>
			{/snippet}
			{#each kits as k (k.id)}
				<tr
					class="hover cursor-pointer"
					use:rowLink={resolve('/staff/inventory/kits/[id]', { id: k.id })}
				>
					<td class="cell-primary">{k.locationName}</td>
					<td class="min-w-0"><EntityChip ref={k.member} icon={false} /></td>
					<td class="whitespace-nowrap">
						{k.dueDate ? formatDateShort(k.dueDate) : '—'}
						{#if k.dueDate && k.dueDate < now}
							<Badge variant="error" size="xs">{m.staff_overdue_label()}</Badge>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	</InfoCard>
{/if}
