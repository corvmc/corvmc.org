<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import {
		getStaffSettingsPage,
		updateOrgSettings,
		updateVolunteerValueSettings,
		updateFeatureFlag,
		syncSubscriptions,
		refreshCommunityStats
	} from '#lib/remote/settings.remote.js';
	import { updateInboxChannelConfig, testMetaConnection } from '#lib/remote/inbox.remote.js';
	import { isAlwaysEnabledChannel } from '#lib/config.js';
	import AccessTab from './access/AccessTab.svelte';
	import { channelLabel, channelIcon } from '#lib/components/inbox/channels.js';
	import { inboxChannelMeta } from './inbox-channel-meta';
	import { featureMeta } from './feature-meta';
	import type { FeatureFlag } from '#lib/server/feature-flags.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import type { SubscriptionSyncSummary } from '#lib/types/subscription-sync.js';
	import type { CommunityStats } from '#lib/server/db/schema/finance.js';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { IconPlugConnected } from '@tabler/icons-svelte';
	import {
		fieldsState,
		hourValueState,
		linksState,
		onOfState,
		organizationBadge,
		switchState
	} from './section-state';

	// `?tab=` opens a tab on arrival.
	let activeTab = $state(page.url.searchParams.get('tab') ?? 'organization');
	// One query. All six are unparameterized, which is what lets every mutation that used to
	// refresh them individually name this wrapper instead.
	const settings = $derived(await getStaffSettingsPage());
	const orgSettings = $derived(settings.org);
	const volunteerValue = $derived(settings.volunteerValue);
	const channelConfigs = $derived(settings.channelConfigs);
	const featureFlags = $derived(settings.featureFlags);

	// Keyed by channel: Instagram and Messenger share one token, but each has its
	// own card, and a result printed under the card the staffer did not press
	// reads as the wrong answer.
	let metaTestResult = $state<Record<string, { ok: boolean; pageName?: string; error?: string }>>(
		{}
	);
	let metaTesting = $state<string | null>(null);

	const location = $derived([
		orgSettings.addressStreet,
		orgSettings.addressCity,
		orgSettings.addressState,
		orgSettings.addressZip
	]);
	const channelsOn = $derived(
		channelConfigs.map((c) => c.enabled || isAlwaysEnabledChannel(c.channel))
	);
	const tabs = $derived([
		{
			key: 'organization',
			label: m.staff_settings_organization_label(),
			badge: organizationBadge([location, [orgSettings.contactEmail]])
		},
		{
			key: 'inbox',
			label: m.staff_settings_inbox_channels_label(),
			badge: onOfState(channelsOn)
		},
		{
			key: 'features',
			label: m.staff_settings_features_label(),
			badge: onOfState(Object.keys(featureMeta).map((f) => featureFlags[f as FeatureFlag]))
		},
		{ key: 'subscriptions', label: m.staff_settings_subscriptions_label() },
		...(settings.canManageAccess ? [{ key: 'access', label: m.staff_settings_access_label() }] : [])
	]);
	// A `?tab=` naming a tab this viewer is not offered opens the first one.
	const shown = $derived(tabs.some((t) => t.key === activeTab) ? activeTab : 'organization');
	// Access holds tables; the other tabs are forms.
	const width = $derived(shown === 'access' ? 'full' : '2xl');

	let syncResult = $state<SubscriptionSyncSummary | null>(null);
	let statsResult = $state<CommunityStats | null>(null);

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
	{width}
	title={m.staff_settings_settings_title()}
	subtitle={m.staff_settings_subtitle_body()}
>
	<TabBar collapse {tabs} active={shown} onchange={(key) => (activeTab = key)} />
</PageHeader>

<PageContent {width}>
	<div class="space-y-4" role="tabpanel" aria-labelledby="tab-{shown}">
		{#if shown === 'organization'}
			<p class="text-muted">
				{m.staff_settings_organization_identity_used_emails_branding_text()}
			</p>

			<Form
				remote={updateOrgSettings}
				guard
				successToast={m.staff_settings_organization_settings_updated_toast()}
			>
				<InfoCard title={m.staff_settings_location_title()} state={fieldsState(location)}>
					<p class="text-subtle">{m.staff_settings_shown_site_footer_contact_page_text()}</p>

					<div class="mt-2 grid gap-4 sm:grid-cols-2">
						<FormField
							field={updateOrgSettings.fields.addressStreet}
							label={m.staff_settings_street_address_label()}
							type="text"
							value={String(orgSettings.addressStreet ?? '')}
							placeholder={m.staff_settings_6775_sw_philomath_blvd_placeholder()}
						/>
						<FormField
							field={updateOrgSettings.fields.addressCity}
							label={m.staff_settings_city_label()}
							type="text"
							value={String(orgSettings.addressCity ?? '')}
							placeholder={m.staff_settings_corvallis_placeholder()}
						/>
						<FormField
							field={updateOrgSettings.fields.addressState}
							label={m.staff_settings_state_label()}
							type="text"
							value={String(orgSettings.addressState ?? '')}
							placeholder={m.staff_settings_text_placeholder()}
						/>
						<FormField
							field={updateOrgSettings.fields.addressZip}
							label={m.staff_settings_zip_label()}
							type="text"
							value={String(orgSettings.addressZip ?? '')}
							placeholder="97333"
						/>
					</div>
				</InfoCard>

				<InfoCard
					title={m.staff_settings_contact_email_title()}
					state={fieldsState([orgSettings.contactEmail])}
				>
					<p class="text-subtle">{m.staff_settings_contact_email_shown_text()}</p>

					<div class="mt-2 grid gap-4 sm:grid-cols-2">
						<FormField
							field={updateOrgSettings.fields.contactEmail}
							label={m.staff_settings_contact_email_label()}
							type="email"
							value={String(orgSettings.contactEmail ?? '')}
							required
						/>
					</div>
				</InfoCard>

				<InfoCard
					title={m.staff_settings_social_links_title()}
					state={linksState([orgSettings.socialFacebook, orgSettings.socialInstagram])}
				>
					<p class="text-subtle">{m.staff_settings_shown_site_footer_leave_blank_text()}</p>

					<div class="mt-2 grid gap-4 sm:grid-cols-2">
						<FormField
							field={updateOrgSettings.fields.socialFacebook}
							label={m.staff_settings_facebook_url_label()}
							type="text"
							value={String(orgSettings.socialFacebook ?? '')}
							placeholder={m.staff_settings_https_facebook_com_placeholder()}
						/>
						<FormField
							field={updateOrgSettings.fields.socialInstagram}
							label={m.staff_settings_instagram_url_label()}
							type="text"
							value={String(orgSettings.socialInstagram ?? '')}
							placeholder={m.staff_settings_https_instagram_com_placeholder()}
						/>
					</div>
				</InfoCard>
				<!-- One form, one Save, named for what it saves. The button used to sit
				     in the first card's header while the form wrapped three of them, so
				     editing an operating hour or a social URL offered no save control in
				     the card you were editing (#1076). Three buttons would have been
				     worse: each one saves all of it. -->
				<div class="flex justify-end">
					<SubmitButton
						label={m.staff_settings_save_organization_settings_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
					/>
				</div>
			</Form>

			<Form
				remote={updateVolunteerValueSettings}
				guard
				successToast={m.staff_settings_volunteer_hour_value_updated_toast()}
			>
				<InfoCard
					title={m.staff_settings_volunteer_hour_value_title()}
					state={hourValueState(volunteerValue.hourValueCents)}
				>
					{#snippet action()}
						<SubmitButton
							label={m.staff_settings_save_label()}
							successLabel={m.staff_settings_saved_label()}
							errorLabel={m.staff_settings_error_label()}
							variant="primary"
							size="sm"
						/>
					{/snippet}
					<p class="text-subtle">
						{m.staff_settings_what_hour_donated_time_worth_text()}
					</p>

					<div class="mt-2 grid gap-4 sm:grid-cols-2">
						<FormField
							field={updateVolunteerValueSettings.fields.hourValueCents}
							submitAs="text"
							label={m.staff_settings_hourly_value_cents_label()}
							type="number"
							value={String(volunteerValue.hourValueCents)}
							placeholder="3766"
						/>
						<FormField
							field={updateVolunteerValueSettings.fields.hourValueSource}
							label={m.staff_settings_source_label()}
							type="text"
							value={volunteerValue.hourValueSource}
							placeholder={m.staff_settings_independent_sector_oregon_2025_placeholder()}
						/>
					</div>
				</InfoCard>
			</Form>
		{:else if shown === 'features'}
			<p class="text-muted">
				{m.staff_settings_enable_disable_feature_modules_members_text()}
			</p>

			{#each Object.entries(featureMeta) as [flag, meta] (flag)}
				{@const enabled = featureFlags[flag as FeatureFlag]}
				{@const toggleForm = updateFeatureFlag.for(flag)}
				<InfoCard title={meta.label} state={switchState(enabled)}>
					{#snippet action()}
						<Form
							remote={toggleForm}
							onsuccess={() => toast.success(`${meta.label} ${enabled ? 'disabled' : 'enabled'}`)}
						>
							<input {...toggleForm.fields.flag.as('hidden', flag)} />
							<input {...toggleForm.fields.enabled.as('hidden', enabled ? 'false' : 'true')} />
							<Button
								type="submit"
								variant={enabled ? 'error' : 'success'}
								outline={enabled}
								size="sm"
							>
								{enabled ? m.staff_settings_disable_label() : m.staff_settings_enable_label()}
							</Button>
						</Form>
					{/snippet}
					<p class="text-subtle">{meta.description}</p>
				</InfoCard>
			{/each}
		{:else if shown === 'inbox'}
			<p class="text-muted">
				{m.staff_settings_enable_disable_communication_channels_staff_text()}
			</p>

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
							<!--
									The page token has no refresh path, so an expired one does not
									announce itself — replies just start failing on a channel nobody is
									watching. This is what makes that visible, and the reason the token
									can stay an env secret rather than growing an OAuth flow.
								-->
							{#if isMeta}
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
							{/if}
						</div>

						{#if metaResult}
							<div
								class="alert {metaResult.ok ? 'alert-success' : 'alert-error'} mt-2 py-2 text-sm"
							>
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
		{:else if shown === 'subscriptions'}
			<p class="text-muted">
				{m.staff_settings_reconciles_every_member_band_subscription_text()}
			</p>

			<Action
				label={m.staff_settings_sync_now_label()}
				successLabel={m.staff_settings_synced_label()}
				successToast={m.staff_settings_subscriptions_synced_from_stripe_toast()}
				action={async () => {
					syncResult = await syncSubscriptions();
				}}
			/>

			{#if syncResult}
				<StatGrid cols={7}>
					<StatCard title={m.staff_settings_scanned_title()} value={syncResult.totalScanned} />
					<StatCard
						title={m.staff_settings_users_updated_title()}
						value={syncResult.usersUpdated}
					/>
					<StatCard
						title={m.staff_settings_users_cleared_title()}
						value={syncResult.usersCleared}
					/>
					<StatCard
						title={m.staff_settings_credits_reconciled_title()}
						value={syncResult.creditsReconciled}
					/>
					<StatCard
						title={m.staff_settings_bands_updated_title()}
						value={syncResult.bandsUpdated}
					/>
					<StatCard
						title={m.staff_settings_bands_cleared_title()}
						value={syncResult.bandsCleared}
					/>
					<StatCard title={m.staff_settings_skipped_title()} value={syncResult.skipped} />
				</StatGrid>

				{#if syncResult.errors.length > 0}
					<Alert type="warning">
						<p class="font-semibold">
							{m.staff_settings_record_s_had_issues_text({ length: syncResult.errors.length })}
						</p>
						<ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm">
							{#each syncResult.errors as err, i (i)}
								<li>
									<Badge variant="ghost">{err.kind}</Badge>
									{err.message}{err.ref ? ` (${err.ref})` : ''}
								</li>
							{/each}
						</ul>
					</Alert>
				{/if}
			{/if}

			<div class="divider"></div>

			<p class="text-muted">
				{m.staff_settings_community_impact_stats_sustaining_members_text()}
			</p>

			<Action
				label={m.staff_settings_refresh_stats_label()}
				successLabel={m.staff_settings_refreshed_label()}
				successToast={m.staff_settings_community_stats_refreshed_toast()}
				action={async () => {
					statsResult = await refreshCommunityStats();
				}}
			/>

			{#if statsResult}
				<StatGrid cols={3}>
					<StatCard
						title={m.staff_settings_sustaining_members_title()}
						value={statsResult.sustainingMemberCount}
					/>
					<StatCard
						title={m.staff_settings_free_hours_month_title()}
						value={statsResult.totalFreeHoursAllocated}
					/>
					<StatCard
						title={m.staff_settings_participation_title()}
						value={`${statsResult.participationPercent}%`}
					/>
				</StatGrid>
			{/if}
		{:else if shown === 'access'}
			<AccessTab />
		{/if}
	</div>
</PageContent>
