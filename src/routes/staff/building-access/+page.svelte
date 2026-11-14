<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { getIntegrationSettings } from '#lib/remote/settings.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import StaffViews from '../StaffViews.svelte';
	import { spaceViews } from '../reservations/views';
	import LockCodes from './LockCodes.svelte';
	import KeyRegister from './KeyRegister.svelte';
	import LockSettings from './LockSettings.svelte';

	/**
	 * Who can get into the building (#2766): the lock and its codes, the key
	 * register, and the lock's settings. The lock-offline email and the U-tec
	 * sign-in land here; `?utec=` carries the sign-in's result.
	 */
	const utec = page.url.searchParams.get('utec');
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

	// The staff layout already fetched this. Lock settings keeps the `settings.read`
	// gate it had on Settings.
	const caps = $derived((await getStaffLayout()).capabilities);
	const canReadSettings = $derived(hasCapability(caps, 'settings.read'));
</script>

<PageHeader title={m.staff_reservations_practice_space_title()}>
	<StaffViews views={spaceViews} active="building-access" />
</PageHeader>

<PageContent>
	<LockCodes />
	<KeyRegister />
	{#if canReadSettings}
		<section
			id="lock-settings"
			class="space-y-2"
			aria-labelledby="lock-settings-title"
			data-testid="lock-settings"
		>
			<h2 id="lock-settings-title" class="font-semibold">
				{m.staff_reservations_lock_settings_title()}
			</h2>
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
</PageContent>
