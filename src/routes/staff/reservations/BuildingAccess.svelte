<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { getBuildingAccess } from '#lib/remote/lock.remote.js';
	import { getIntegrationSettings } from '#lib/remote/settings.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import { formatDateShort, formatDateTimeShort, formatTimeRange } from '#lib/utils/format.js';
	import LockSettings from './LockSettings.svelte';

	let {
		open = $bindable(false),
		offline,
		utec = null
	}: {
		open?: boolean;
		offline: boolean;
		/** `?utec=` from the U-tec sign-in's return, read by the page before it rewrites the URL. */
		utec?: string | null;
	} = $props();

	// The query waits for the sidebar to open.
	const data = $derived(open ? getBuildingAccess() : null);
	// Deduped to the staff layout's own call.
	const caps = $derived((await getStaffLayout()).capabilities);
	const canReadSettings = $derived(hasCapability(caps, 'settings.read'));

	const utecResult: Record<string, [type: 'success' | 'error', msg: () => string]> = {
		connected: ['success', m.staff_settings_utec_connected_toast],
		denied: ['error', m.staff_settings_utec_denied_toast],
		state_error: ['error', m.staff_settings_utec_state_error_toast],
		exchange_failed: ['error', m.staff_settings_utec_exchange_failed_toast],
		missing_config: ['error', m.staff_settings_utec_missing_config_toast]
	};

	$effect(() => {
		const entry = utecResult[utec ?? ''];
		if (entry) untrack(() => toast[entry[0]](entry[1]()));
	});
</script>

<Button variant="ghost" size="sm" onclick={() => (open = true)} data-testid="building-access">
	{m.staff_reservations_building_access_label()}
	{#if offline}
		<span class="status status-error" data-testid="lock-offline-dot">
			<span class="sr-only">{m.staff_reservations_lock_offline_text()}</span>
		</span>
	{/if}
</Button>

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

<Modal bind:open title={m.staff_reservations_building_access_title()} placement="end">
	{#if data}
		{#await data}
			<span class="loading loading-md loading-spinner"></span>
		{:then access}
			{@const { status, codes } = access}
			<section class="space-y-2" aria-labelledby="lock-status-title" data-testid="lock-status">
				<h3 id="lock-status-title" class="font-semibold">
					{m.staff_reservations_lock_status_title()}
				</h3>
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

			<section class="mt-6" aria-labelledby="active-codes-title" data-testid="active-codes">
				<h3 id="active-codes-title" class="font-semibold">
					{m.staff_reservations_active_codes_title()}
				</h3>

				<h4 class="mt-3 text-muted text-sm font-medium">
					{m.staff_reservations_reservation_codes_title()}
					<span class="text-subtle">{codes.reservations.length}</span>
				</h4>
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

				<h4 class="mt-3 text-muted text-sm font-medium">
					{m.staff_reservations_key_holder_codes_title()}
					<span class="text-subtle">{codes.keyHolders.length}</span>
				</h4>
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

				<h4 class="mt-3 text-muted text-sm font-medium">
					{m.staff_reservations_break_glass_codes_title()}
				</h4>
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

		{#if canReadSettings}
			<section
				id="lock-settings"
				class="mt-6"
				aria-labelledby="lock-settings-title"
				data-testid="lock-settings"
			>
				<h3 id="lock-settings-title" class="mb-2 font-semibold">
					{m.staff_reservations_lock_settings_title()}
				</h3>
				<svelte:boundary>
					<LockSettings />
					{#snippet failed(error, reset)}
						<Alert type="warning" reset={() => retryQuery(getIntegrationSettings(), reset)}>
							{errorMessage(error)}
						</Alert>
					{/snippet}
				</svelte:boundary>
			</section>
		{/if}

		<div class="mt-6 flex flex-wrap gap-2 border-t border-base-200 pt-3">
			<Button variant="ghost" size="sm" href={resolve('staff/keys')}>
				{m.staff_reservations_key_holders_label()}
			</Button>
			{#if canReadSettings}
				<Button variant="ghost" size="sm" href="#lock-settings">
					{m.staff_reservations_lock_settings_label()}
				</Button>
			{/if}
		</div>
	{/if}
</Modal>
