<script lang="ts">
	import Table from '$lib/components/ui/Table.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import { rowLink } from '$lib/actions/row-link';
	import { formatCents, formatDateShortYear, formatTimeRange } from '$lib/utils/format';
	import { memberPayAction } from '$lib/utils/reservation-actions';
	import type { Reservation } from '$lib/server/db/schema';

	/**
	 * Past sessions still owed (#2117). The time range stacks under the date so
	 * three columns fit a phone without scrolling.
	 */
	let { reservations }: { reservations: (Reservation & { price?: number })[] } = $props();
</script>

<Table zebra={false}>
	{#snippet head()}
		<th>Date</th>
		<th class="cell-num">Amount due</th>
		<th class="w-px"><span class="sr-only">Actions</span></th>
	{/snippet}
	{#each reservations as reservation (reservation.id)}
		{@const href = resolve('/member/reservations/[id]', { id: reservation.id })}
		<tr class="hover cursor-pointer" use:rowLink={href}>
			<td class="cell-primary">
				<a {href} class="block font-medium whitespace-nowrap">
					{formatDateShortYear(reservation.startsAt)}
				</a>
				<span class="block text-muted whitespace-nowrap">
					{formatTimeRange(reservation.startsAt, reservation.endsAt)}
				</span>
			</td>
			<td class="cell-num">
				{reservation.price != null ? formatCents(Math.round(reservation.price * 100)) : ''}
			</td>
			<td class="text-right">
				{#if memberPayAction(reservation) === 'balance'}
					<Button
						href={resolve('/member/reservations/[id]/pay', { id: reservation.id })}
						variant="primary"
						size="xs"
						outline
					>
						Pay online
					</Button>
				{/if}
			</td>
		</tr>
	{/each}
</Table>
