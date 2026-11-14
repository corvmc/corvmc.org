<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		getIntegrationSettings,
		updateIntegrationSettings,
		testUtecConnection,
		runLockSelfTest,
		revokeLockTest
	} from '#lib/remote/settings.remote.js';
	import { getLockHealth, getUnmanagedLockUsers } from '#lib/remote/lock.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { IconPlugConnected, IconCircleCheck, IconCircleX, IconCopy } from '@tabler/icons-svelte';
	import LockHealth from './LockHealth.svelte';
	import UnmanagedLockCodes from './UnmanagedLockCodes.svelte';
	import UtecDevicePicker from './UtecDevicePicker.svelte';

	// The U-tec card, moved from Settings → Integrations (#2586). Its own query,
	// fetched when the sidebar opens; `settings.read` gates it as it did there.
	const integration = $derived(await getIntegrationSettings());
	const connected = $derived(integration.connected);
	const canConnect = $derived(!!integration.clientId && integration.clientSecret.configured);

	// The field renders empty either way, so the hint is what says whether a secret is set.
	const clientSecretHint = $derived(
		{
			kv: 'Saved here. Leave blank to keep it.',
			env: 'Set by the ULTRALOC_CLIENT_SECRET environment variable. Saving a value here overrides it.',
			null: 'Not set. Paste the secret from the U-tec developer console.'
		}[String(integration.clientSecret.source)]
	);
	const redirectUri = $derived(`${page.url.origin}/api/integrations/utec/callback`);

	// Credentials sit behind Reconnect; with no account connected there is nothing to hide them behind.
	let reconnectOpen = $state(false);
	const showCredentials = $derived(reconnectOpen || !connected);

	let connectionResult = $state<{ ok: boolean; error?: string } | null>(null);
	let connectionTesting = $state(false);
	let selfTestResult = $state<Awaited<ReturnType<typeof runLockSelfTest>> | null>(null);
	let selfTesting = $state(false);
	let revokingTest = $state(false);

	async function testConnection() {
		connectionTesting = true;
		connectionResult = null;
		try {
			connectionResult = await testUtecConnection();
		} finally {
			connectionTesting = false;
		}
	}

	async function selfTest() {
		selfTesting = true;
		selfTestResult = null;
		try {
			selfTestResult = await runLockSelfTest();
		} catch (err) {
			selfTestResult = {
				ok: false,
				steps: [{ name: 'create', ok: false, detail: (err as Error).message }]
			};
		} finally {
			selfTesting = false;
		}
	}

	async function revokeTest() {
		revokingTest = true;
		try {
			const { removed } = await revokeLockTest();
			selfTestResult = null;
			toast.success(
				removed > 0
					? m.staff_settings_removed_test_code_s_toast({ removed })
					: m.staff_settings_no_test_codes_remove_toast()
			);
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			revokingTest = false;
		}
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<span class="text-sm font-medium">{m.staff_reservations_utec_account_text()}</span>
	<Badge variant={connected ? 'success' : 'ghost'}>
		{connected ? m.staff_settings_connected_2_label() : m.staff_settings_not_connected_label()}
	</Badge>
</div>

{#if connected}
	<svelte:boundary>
		<LockHealth />
		{#snippet failed(error, reset)}
			<Alert type="warning" reset={() => retryQuery(getLockHealth(), reset)}>
				{m.staff_settings_lock_did_not_answer_body({ errorMessage: errorMessage(error) })}
			</Alert>
		{/snippet}
	</svelte:boundary>
{/if}

<div class="mt-3 flex flex-wrap gap-2">
	{#if connected}
		<Button
			type="button"
			variant="default"
			size="sm"
			outline
			onclick={testConnection}
			disabled={connectionTesting}
			data-testid="test-connection"
		>
			{#if connectionTesting}
				<span class="loading loading-xs loading-spinner"></span>
			{:else}
				<IconPlugConnected class="size-4" />
			{/if}
			{m.staff_settings_test_connection_label()}
		</Button>
		<Button
			type="button"
			variant="default"
			size="sm"
			outline
			onclick={selfTest}
			disabled={selfTesting}
		>
			{#if selfTesting}
				<span class="loading loading-xs loading-spinner"></span>
			{/if}
			{m.staff_settings_run_lock_self_test_label()}
		</Button>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			aria-expanded={reconnectOpen}
			onclick={() => (reconnectOpen = !reconnectOpen)}
			data-testid="reconnect"
		>
			{m.staff_settings_reconnect_label()}
		</Button>
	{/if}
</div>

{#if connectionResult}
	<div class="alert {connectionResult.ok ? 'alert-success' : 'alert-error'} mt-2 py-2 text-sm">
		{connectionResult.ok
			? m.staff_settings_connection_successful_token_refresh_verified_text()
			: m.staff_settings_connection_failed_text({ error: connectionResult.error ?? '' })}
	</div>
{/if}

{#if selfTestResult}
	<div class="mt-3 rounded-lg border border-base-300 p-3">
		{#if selfTestResult.code}
			<div class="mb-2 flex items-baseline gap-2">
				<span class="text-subtle">{m.staff_settings_test_code_text()}</span>
				<span class="font-mono text-2xl font-bold tracking-[0.2em]">{selfTestResult.code}</span>
			</div>
		{/if}
		<ul class="space-y-1 text-sm">
			{#each selfTestResult.steps as step (step.name)}
				<li class="flex items-start gap-2">
					{#if step.ok}
						<IconCircleCheck class="size-4 shrink-0 text-success" />
					{:else}
						<IconCircleX class="size-4 shrink-0 text-error" />
					{/if}
					<span class="opacity-80">{step.detail}</span>
				</li>
			{/each}
		</ul>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class="mt-2"
			onclick={revokeTest}
			disabled={revokingTest}
		>
			{m.staff_settings_revoke_test_codes_label()}
		</Button>
	</div>
{/if}

{#if connected}
	<svelte:boundary>
		<UnmanagedLockCodes />
		{#snippet failed(error, reset)}
			<Alert type="warning" reset={() => retryQuery(getUnmanagedLockUsers(), reset)}>
				{m.staff_settings_could_not_read_lock_s_body({ errorMessage: errorMessage(error) })}
			</Alert>
		{/snippet}
	</svelte:boundary>
{/if}

{#if showCredentials}
	<Form
		remote={updateIntegrationSettings}
		guard
		successToast={m.staff_settings_u_tec_credentials_updated_toast()}
		class="mt-3 space-y-3 border-t border-base-200 pt-3"
	>
		<FormField
			field={updateIntegrationSettings.fields.clientId}
			label={m.staff_settings_client_id_label()}
			type="text"
			value={integration.clientId}
		/>
		<FormField
			field={updateIntegrationSettings.fields.clientSecret}
			label={m.staff_settings_client_secret_label()}
			type="password"
			value=""
			description={clientSecretHint}
		/>
		<svelte:boundary>
			<UtecDevicePicker deviceId={integration.deviceId} />
			{#snippet failed()}
				<FormField
					field={updateIntegrationSettings.fields.deviceId}
					label={m.staff_settings_device_id_label()}
					type="text"
					value={integration.deviceId}
					description={m.staff_settings_could_not_reach_u_tec_body()}
				/>
			{/snippet}
		</svelte:boundary>

		<div>
			<p class="text-subtle">{m.staff_settings_redirect_uri_register_exact_value_text()}</p>
			<div class="mt-1 flex items-center gap-2">
				<code class="flex-1 truncate code-block px-2 py-1">{redirectUri}</code>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					title={m.staff_settings_copy_redirect_uri_title()}
					onclick={() => {
						navigator.clipboard.writeText(redirectUri);
						toast.success(m.staff_settings_redirect_uri_copied_toast());
					}}
				>
					<IconCopy class="size-3.5" />
				</Button>
			</div>
		</div>

		{#if !canConnect}
			<p class="text-subtle">{m.staff_settings_save_client_id_client_secret_text()}</p>
		{/if}
		<p class="text-subtle">{m.staff_settings_click_connect_u_tec_authorize_text()}</p>

		<div class="flex flex-wrap gap-2">
			<SubmitButton
				label={m.staff_settings_save_label()}
				successLabel={m.staff_settings_saved_label()}
				errorLabel={m.staff_settings_error_label()}
				variant="primary"
				size="sm"
			/>
			<Button
				href={resolve('api/integrations/utec/authorize')}
				variant="default"
				size="sm"
				class={canConnect ? '' : 'btn-disabled'}
				data-sveltekit-reload
			>
				<IconPlugConnected class="size-4" />
				{connected ? m.staff_settings_reconnect_label() : m.staff_settings_connect_u_tec_label()}
			</Button>
		</div>
	</Form>
{/if}
