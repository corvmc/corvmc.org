<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { IconPlugConnected } from '@tabler/icons-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import {
		getInboxChannelConfigs,
		updateInboxChannelConfig,
		testMetaConnection
	} from '#lib/remote/inbox.remote.js';
	import { isAlwaysEnabledChannel } from '#lib/config.js';
	import { channelLabel, channelIcon } from '#lib/components/inbox/channels.js';
	import IfHeld from '../../IfHeld.svelte';
	import { switchState } from '../../section-state';
	import { inboxChannelMeta } from './inbox-channel-meta';

	// Inbox's settings view (#2763): `inbox.read` sees it, `inbox.manageChannels`
	// changes it.
	const channelConfigs = $derived(await getInboxChannelConfigs());

	// Keyed by channel: Instagram and Messenger share one token, but each has its
	// own card, and a result printed under the card the staffer did not press
	// reads as the wrong answer.
	let metaTestResult = $state<Record<string, { ok: boolean; pageName?: string; error?: string }>>(
		{}
	);
	let metaTesting = $state<string | null>(null);

	async function handleMetaTest(channel: string) {
		metaTesting = channel;
		try {
			metaTestResult = { ...metaTestResult, [channel]: await testMetaConnection() };
		} catch (err) {
			metaTestResult = {
				...metaTestResult,
				[channel]: { ok: false, error: (err as Error).message }
			};
		} finally {
			metaTesting = null;
		}
	}
</script>

<PageHeader
	width="2xl"
	title={m.staff_inbox_channels_title()}
	subtitle={m.staff_settings_enable_disable_communication_channels_staff_body()}
>
	<Button href={resolve('staff/inbox')} variant="ghost" size="sm">
		{m.staff_inbox_inbox_toolbar_inbox_label()}
	</Button>
</PageHeader>

<PageContent width="2xl">
	<div class="space-y-4">
		{#each channelConfigs as cfg (cfg.channel)}
			{@const meta = inboxChannelMeta[cfg.channel]}
			{@const label = channelLabel(cfg.channel)}
			{@const isAlwaysOn = isAlwaysEnabledChannel(cfg.channel)}
			{@const ChannelIcon = channelIcon(cfg.channel)}
			{@const toggleForm = updateInboxChannelConfig.for(cfg.channel)}
			{@const isMeta = cfg.channel === 'instagram' || cfg.channel === 'messenger'}
			{@const metaResult = metaTestResult[cfg.channel]}
			<InfoCard
				title={label}
				state={isAlwaysOn ? m.staff_settings_always_label() : switchState(cfg.enabled)}
				testid="channel-{cfg.channel}"
			>
				{#snippet action()}
					{#if !isAlwaysOn}
						<IfHeld cap="inbox.manageChannels">
							<Form
								remote={toggleForm}
								onsuccess={() => toast.success(`${label} ${cfg.enabled ? 'disabled' : 'enabled'}`)}
							>
								<input {...toggleForm.fields.channel.as('hidden', cfg.channel)} />
								<input
									{...toggleForm.fields.enabled.as('hidden', cfg.enabled ? 'false' : 'true')}
								/>
								<Button
									type="submit"
									variant={cfg.enabled ? 'error' : 'success'}
									outline={cfg.enabled}
									size="sm"
								>
									{cfg.enabled ? m.staff_settings_disable_label() : m.staff_settings_enable_label()}
								</Button>
							</Form>
						</IfHeld>
					{/if}
				{/snippet}
				<p class="flex items-center gap-2 text-subtle">
					<ChannelIcon size={16} class="shrink-0 opacity-60" />{meta.description}
				</p>
				{#if !isAlwaysOn}
					<div class="mt-2 flex flex-wrap items-center justify-between gap-2">
						<div class="text-xs opacity-40">
							{m.staff_settings_env_text({ envHint: meta.envHint })}
						</div>
						<!-- The page token has no refresh path, so an expired one does not
						     announce itself: replies start failing on a channel nobody is
						     watching. This makes that visible, and lets the token stay an
						     env secret rather than growing an OAuth flow. -->
						{#if isMeta}
							<IfHeld cap="inbox.manageChannels">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onclick={() => handleMetaTest(cfg.channel)}
									disabled={metaTesting === cfg.channel}
								>
									{#if metaTesting === cfg.channel}
										<span class="loading loading-xs loading-spinner"></span>
									{:else}
										<IconPlugConnected class="size-4" />
									{/if}
									{m.staff_settings_test_connection_2_label()}
								</Button>
							</IfHeld>
						{/if}
					</div>

					{#if metaResult}
						<div class="alert {metaResult.ok ? 'alert-success' : 'alert-error'} mt-2 py-2 text-sm">
							{#if metaResult.ok}
								{m.staff_settings_connected_text({ pageName: metaResult.pageName ?? '' })}
							{:else}
								{metaResult.error}
							{/if}
						</div>
					{/if}
				{/if}
			</InfoCard>
		{/each}
	</div>
</PageContent>
