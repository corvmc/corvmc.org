<script lang="ts">
	// Booking codes (#2120): pre-minted lock users handed to a booking only
	// when its own access fails. A revealed code stays on the lock until the
	// lock confirms its removal, so "Awaiting removal" still opens the door.
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getPoolCodes } from '$lib/remote/lock.remote';
	import { formatDateShort, formatDateTimeShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	const pool = $derived(await getPoolCodes());
	const handedOut = $derived(
		pool.codes.filter((c) => c.state !== 'available' && c.state !== 'pending')
	);
	const pending = $derived(pool.codes.filter((c) => c.state === 'pending').length);

	const stateLabel = {
		pending: 'Not on the lock yet',
		available: 'Ready',
		claimed: 'Claimed',
		awaiting_removal: 'Awaiting removal',
		removed: 'Removed'
	} as const;
	const stateVariant = {
		pending: 'warning',
		available: 'success',
		claimed: 'info',
		awaiting_removal: 'error',
		removed: 'ghost'
	} as const;
</script>

<p class="mb-3">
	<span class="font-medium">{pool.available}</span>
	<span class="text-subtle">ready on the lock</span>
	{#if pending}
		<span class="text-subtle">· {pending} waiting for the lock to confirm</span>
	{/if}
</p>

{#if handedOut.length === 0}
	<EmptyState title="No booking codes handed out" />
{:else}
	<Table>
		{#snippet head()}
			<th>Code</th>
			<th>Booking</th>
			<th>Revealed</th>
			<th>State</th>
		{/snippet}
		{#each handedOut as c (c.id)}
			<tr>
				<td class="cell-primary font-mono">{c.code}</td>
				<td>
					{#if c.reservationId && c.bookingStartsAt}
						<a class="link" href={resolve('/staff/reservations/[id]', { id: c.reservationId })}>
							{formatDateTimeShort(c.bookingStartsAt)}
						</a>
					{:else if c.legacy}
						<span class="text-subtle">Break-glass code</span>
					{:else}
						<span class="text-subtle">—</span>
					{/if}
				</td>
				<td>{c.revealedAt ? formatDateShort(c.revealedAt) : ''}</td>
				<td>
					<Badge variant={stateVariant[c.state]} size="sm">{stateLabel[c.state]}</Badge>
				</td>
			</tr>
		{/each}
	</Table>
{/if}
