<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { getBuildingAccess } from '#lib/remote/lock.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { formatDateShort, formatDateTimeShort, formatTimeRange } from '#lib/utils/format.js';

	// The lock's state and every code it should hold, on the Building access view (#2766).
</script>

{#snippet codeRow(name: string, tail: string | null, onLock: boolean, detail?: string)}
	<li class="flex items-center justify-between gap-3 py-2" data-testid="lock-code">
		<div class="min-w-0">
			<p class="truncate font-medium">{name}</p>
			{#if detail}<p class="text-subtle">{detail}</p>{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if tail}
				<span class="font-mono" aria-label={m.staff_reservations_code_ending_label({ tail })}
					>••{tail}</span
				>
			{/if}
			<Badge size="sm" variant={onLock ? 'success' : 'warning'}>
				{onLock ? m.staff_reservations_on_lock_label() : m.staff_reservations_waiting_label()}
			</Badge>
		</div>
	</li>
{/snippet}

{#await getBuildingAccess()}
	<span class="loading loading-md loading-spinner"></span>
{:then access}
	{@const { status, codes } = access}
	<section class="space-y-2" aria-labelledby="lock-status-title" data-testid="lock-status">
		<h2 id="lock-status-title" class="font-semibold">
			{m.staff_reservations_lock_status_title()}
		</h2>
		<div class="flex flex-wrap items-center gap-2">
			{#if status.online === true}
				<Badge variant="success">{m.staff_reservations_lock_online_label()}</Badge>
			{:else if status.online === false}
				<Badge variant="error">{m.staff_reservations_lock_offline_label()}</Badge>
			{:else}
				<Badge variant="ghost">{m.staff_reservations_lock_unknown_label()}</Badge>
			{/if}
			{#if status.lastOnlineAt}
				<span class="text-subtle">
					{m.staff_reservations_last_seen_text({
						when: formatDateTimeShort(new Date(status.lastOnlineAt))
					})}
				</span>
			{/if}
		</div>
		{#if status.online === false}
			<p class="text-sm">{m.staff_reservations_codes_reach_lock_text()}</p>
		{/if}
	</section>

	<section aria-labelledby="active-codes-title" data-testid="active-codes">
		<h2 id="active-codes-title" class="font-semibold">
			{m.staff_reservations_active_codes_title()}
		</h2>

		<h3 class="mt-3 text-muted text-sm font-medium">
			{m.staff_reservations_reservation_codes_title()}
			<span class="text-subtle">{codes.reservations.length}</span>
		</h3>
		<ul class="divide-y divide-base-200">
			{#each codes.reservations as c (c.id)}
				{@render codeRow(
					c.name,
					c.tail,
					c.onLock,
					`${formatDateShort(c.startsAt)}, ${formatTimeRange(c.startsAt, c.endsAt)}`
				)}
			{:else}
				<li class="py-2 text-subtle">{m.staff_reservations_no_codes_text()}</li>
			{/each}
		</ul>

		<h3 class="mt-3 text-muted text-sm font-medium">
			{m.staff_reservations_key_holder_codes_title()}
			<span class="text-subtle">{codes.keyHolders.length}</span>
		</h3>
		<ul class="divide-y divide-base-200">
			{#each codes.keyHolders as c (c.id)}
				{@render codeRow(
					c.name,
					c.tail,
					c.onLock,
					c.adopted ? m.staff_reservations_unassigned_text() : undefined
				)}
			{:else}
				<li class="py-2 text-subtle">{m.staff_reservations_no_codes_text()}</li>
			{/each}
		</ul>

		<h3 class="mt-3 text-muted text-sm font-medium">
			{m.staff_reservations_break_glass_codes_title()}
		</h3>
		<ul class="divide-y divide-base-200">
			{#each codes.breakGlass as c (c.id)}
				{@render codeRow(
					m.staff_reservations_break_glass_code_text(),
					c.tail,
					c.onLock,
					c.rotatesAt
						? m.staff_reservations_rotates_text({ date: formatDateShort(c.rotatesAt) })
						: undefined
				)}
			{:else}
				<li class="py-2 text-subtle">{m.staff_reservations_no_codes_text()}</li>
			{/each}
		</ul>
	</section>
{:catch error}
	<Alert type="warning" reset={() => getBuildingAccess().refresh()}>
		{errorMessage(error)}
	</Alert>
{/await}
