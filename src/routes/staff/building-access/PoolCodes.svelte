<script lang="ts">
	// Booking codes (#2120): pre-minted lock users a booking claims when its
	// door-code notice goes out. A claimed code stays on the lock until the lock
	// confirms its removal, so "Awaiting removal" still opens the door.
	import { m } from '#lib/paraglide/messages.js';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { getPoolCodes } from '#lib/remote/lock.remote.js';
	import { formatDateShort, formatDateTimeShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';

	const pool = $derived(await getPoolCodes());
	const handedOut = $derived(
		pool.codes.filter((c) => c.state !== 'available' && c.state !== 'pending')
	);
	const pending = $derived(pool.codes.filter((c) => c.state === 'pending').length);

	const stateLabel = {
		pending: m.staff_pool_codes_pending_label,
		available: m.staff_pool_codes_available_label,
		claimed: m.staff_pool_codes_claimed_label,
		awaiting_removal: m.staff_pool_codes_awaiting_removal_label,
		removed: m.staff_pool_codes_removed_label
	} as const;
	const stateVariant = {
		pending: 'warning',
		available: 'success',
		claimed: 'info',
		awaiting_removal: 'error',
		removed: 'ghost'
	} as const;
</script>

<section class="space-y-2" aria-labelledby="pool-codes-title" data-testid="pool-codes">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 id="pool-codes-title" class="font-semibold">{m.staff_pool_codes_title()}</h2>
		<Button href={resolve('/staff/building-access/door-poster')} variant="ghost" size="sm">
			{m.staff_pool_codes_poster_label()}
		</Button>
	</div>
	<p>
		<span class="font-medium">{pool.available}</span>
		<span class="text-subtle">{m.staff_pool_codes_ready_text()}</span>
		{#if pending}
			<span class="text-subtle">{m.staff_pool_codes_waiting_text({ count: pending })}</span>
		{/if}
	</p>

	{#if handedOut.length === 0}
		<EmptyState title={m.staff_pool_codes_none_title()} />
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_pool_codes_code_label()}</th>
				<th>{m.staff_pool_codes_booking_label()}</th>
				<th>{m.staff_pool_codes_revealed_label()}</th>
				<th>{m.staff_pool_codes_state_label()}</th>
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
							<span class="text-subtle">{m.staff_pool_codes_break_glass_text()}</span>
						{:else}
							<span class="text-subtle">—</span>
						{/if}
					</td>
					<td>{c.revealedAt ? formatDateShort(c.revealedAt) : ''}</td>
					<td>
						<Badge variant={stateVariant[c.state]} size="sm">{stateLabel[c.state]()}</Badge>
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</section>
