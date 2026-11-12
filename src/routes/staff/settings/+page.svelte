<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import {
		getStaffSettingsPage,
		updateProduct,
		updateReservationSettings,
		updateOrgSettings,
		updateVolunteerValueSettings,
		updateOrientationSettings,
		updateVenueSettings,
		updateFeatureFlag,
		syncSubscriptions,
		refreshCommunityStats
	} from '#lib/remote/settings.remote.js';
	import { updateInboxChannelConfig, testMetaConnection } from '#lib/remote/inbox.remote.js';
	import { isAlwaysEnabledChannel } from '#lib/config.js';
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
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import type { SubscriptionSyncSummary } from '#lib/types/subscription-sync.js';
	import type { CommunityStats } from '#lib/server/db/schema/finance.js';
	import { formatDollars } from '#lib/utils/format.js';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { IconPlugConnected, IconToggleRight, IconToggleLeft } from '@tabler/icons-svelte';

	// `?tab=` opens a tab on arrival.
	let activeTab = $state(page.url.searchParams.get('tab') ?? 'pricing');
	// One query. All six are unparameterized, which is what lets every mutation that used to
	// refresh them individually name this wrapper instead.
	const settings = $derived(await getStaffSettingsPage());
	const products = $derived(settings.products);
	const reservationSettings = $derived(settings.reservation);
	const orgSettings = $derived(settings.org);
	const volunteerValue = $derived(settings.volunteerValue);
	const orientation = $derived(settings.orientation);
	const venue = $derived(settings.venue);
	const channelConfigs = $derived(settings.channelConfigs);
	const featureFlags = $derived(settings.featureFlags);

	const { fields: reservationFields } = updateReservationSettings;

	// Keyed by channel: Instagram and Messenger share one token, but each has its
	// own card, and a result printed under the card the staffer did not press
	// reads as the wrong answer.
	let metaTestResult = $state<Record<string, { ok: boolean; pageName?: string; error?: string }>>(
		{}
	);
	let metaTesting = $state<string | null>(null);

	const tabs = [
		{ key: 'pricing', label: m.staff_settings_pricing_label() },
		{ key: 'reservations', label: m.staff_settings_reservations_label() },
		{ key: 'organization', label: m.staff_settings_organization_label() },
		{ key: 'inbox', label: m.staff_settings_inbox_channels_label() },
		{ key: 'features', label: m.staff_settings_features_label() },
		{ key: 'subscriptions', label: m.staff_settings_subscriptions_label() }
	];

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
	width="2xl"
	title={m.staff_settings_settings_title()}
	subtitle={m.staff_settings_subtitle_body()}
>
	<TabBar collapse {tabs} active={activeTab} onchange={(key) => (activeTab = key)} />
</PageHeader>

<PageContent width="2xl">
	<div class="space-y-4" role="tabpanel" aria-labelledby="tab-{activeTab}">
		{#if activeTab === 'pricing'}
			<p class="text-muted">
				{m.staff_settings_configure_products_pricing_used_checkout_text()}
			</p>

			{#each products as product (product.key)}
				{@const isFee = product.key === 'fee_coverage'}
				{@const instance = updateProduct.for(product.key)}
				<Form
					remote={instance}
					successToast={m.staff_settings_updated_toast({ name: product.name })}
				>
					<Card>
						<CardBody>
							<div class="flex items-center justify-between">
								<CardTitle size="base">{product.name}</CardTitle>
								<SubmitButton
									label={m.staff_settings_save_label()}
									successLabel={m.staff_settings_saved_label()}
									errorLabel={m.staff_settings_error_label()}
									variant="primary"
									size="sm"
								/>
							</div>

							{#if product.stripeProductId}
								<p class="font-mono text-subtle">{product.stripeProductId}</p>
							{:else}
								<p class="text-subtle">
									{m.staff_settings_stripe_product_will_created_first_text()}
								</p>
							{/if}

							<input {...instance.fields.key.as('hidden', product.key)} />

							<div class="mt-2 grid gap-4 sm:grid-cols-2">
								<div class="fieldset">
									<label class="label" for="name-{product.key}">
										<span class="fieldset-legend">{m.staff_settings_product_name_label()}</span>
									</label>
									{#each instance.fields.name.issues() ?? [] as issue (issue.message)}
										<p class="text-sm text-error">{issue.message}</p>
									{/each}
									<input
										id="name-{product.key}"
										{...instance.fields.name.as('text', product.name)}
										type="text"
										class="input input-sm"
									/>
								</div>

								{#if !isFee}
									<div class="fieldset">
										<label class="label" for="amount-{product.key}">
											<span class="fieldset-legend">
												{m.staff_settings_amount_label({
													unitLabel: product.unitLabel ?? m.staff_settings_per_unit_text()
												})}
											</span>
										</label>
										{#each instance.fields.unitAmountCents.issues() ?? [] as issue (issue.message)}
											<p class="text-sm text-error">{issue.message}</p>
										{/each}
										<label class="input flex items-center gap-1 input-sm">
											<span class="opacity-60">$</span>
											<input
												id="amount-{product.key}"
												type="number"
												step="0.01"
												min="0"
												value={formatDollars(product.unitAmountCents)}
												oninput={(e) => {
													const input = e.target as HTMLInputElement;
													const dollars = parseFloat(input.value);
													const hidden = input
														.closest('form')
														?.querySelector<HTMLInputElement>(
															`[name="${instance.fields.unitAmountCents.as('hidden', '').name}"]`
														);
													if (hidden && !isNaN(dollars))
														hidden.value = String(Math.round(dollars * 100));
												}}
												class="grow bg-transparent outline-none"
											/>
										</label>
										<input
											{...instance.fields.unitAmountCents.as(
												'hidden',
												String(product.unitAmountCents)
											)}
										/>
									</div>
								{:else}
									<input {...instance.fields.unitAmountCents.as('hidden', '0')} />
								{/if}
							</div>

							<div class="mt-2 fieldset">
								<label class="label" for="desc-{product.key}">
									<span class="fieldset-legend">{m.staff_settings_description_label()}</span>
								</label>
								<textarea
									id="desc-{product.key}"
									{...instance.fields.description.as('text', product.description ?? '')}
									class="textarea textarea-sm"
									rows="2"></textarea>
							</div>
						</CardBody>
					</Card>
				</Form>
			{/each}
		{:else if activeTab === 'reservations'}
			<p class="text-muted">
				{m.staff_settings_configure_operating_hours_booking_rules_text()}
			</p>

			<Form
				remote={updateReservationSettings}
				guard
				successToast={m.staff_settings_reservation_settings_updated_toast()}
			>
				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_pricing_title()}</CardTitle>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<div class="fieldset">
								<label class="label" for="hourlyRate">
									<span class="fieldset-legend">{m.staff_settings_hourly_rate_label()}</span>
								</label>
								<label class="input flex items-center gap-1 input-sm">
									<span class="opacity-60">$</span>
									<input
										id="hourlyRate"
										type="number"
										step="0.01"
										min="0"
										value={formatDollars(Number(reservationSettings.hourlyRateCents ?? 1500))}
										oninput={(e) => {
											const input = e.target as HTMLInputElement;
											const dollars = parseFloat(input.value);
											const hidden = input
												.closest('form')
												?.querySelector<HTMLInputElement>(
													`[name="${reservationFields.hourlyRateCents.as('hidden', '').name}"]`
												);
											if (hidden && !isNaN(dollars))
												hidden.value = String(Math.round(dollars * 100));
										}}
										class="grow bg-transparent outline-none"
									/>
								</label>
								<input
									{...reservationFields.hourlyRateCents.as(
										'hidden',
										String(reservationSettings.hourlyRateCents ?? 1500)
									)}
								/>
							</div>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_operating_hours_title()}</CardTitle>
						</div>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateReservationSettings.fields.operatingHoursStart}
								label={m.staff_settings_opens_at_label()}
								type="time"
								value={String(reservationSettings.operatingHoursStart ?? '09:00')}
							/>
							<FormField
								field={updateReservationSettings.fields.operatingHoursEnd}
								label={m.staff_settings_closes_at_label()}
								type="time"
								value={String(reservationSettings.operatingHoursEnd ?? '22:00')}
							/>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_booking_rules_title()}</CardTitle>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateReservationSettings.fields.timeSlotMinutes}
								label={m.staff_settings_time_slot_granularity_label()}
								type="select"
								value={String(reservationSettings.timeSlotMinutes ?? 30)}
								options={[
									{ value: '15', label: m.staff_settings_15_minutes_label() },
									{ value: '30', label: m.staff_settings_30_minutes_label() },
									{ value: '60', label: m.staff_settings_60_minutes_label() }
								]}
							/>
							<FormField
								field={updateReservationSettings.fields.bufferMinutes}
								submitAs="text"
								label={m.staff_settings_buffer_between_reservations_min_label()}
								type="number"
								value={String(reservationSettings.bufferMinutes ?? 0)}
								min="0"
								step="5"
							/>
							<FormField
								field={updateReservationSettings.fields.minAdvanceMinutes}
								submitAs="text"
								label={m.staff_settings_min_advance_booking_minutes_label()}
								type="number"
								value={String(reservationSettings.minAdvanceMinutes ?? 60)}
								min="0"
								step="15"
							/>
							<FormField
								field={updateReservationSettings.fields.newMemberMinAdvanceMinutes}
								submitAs="text"
								label={m.staff_settings_first_booking_notice_minutes_label()}
								type="number"
								value={String(reservationSettings.newMemberMinAdvanceMinutes ?? 4320)}
								min="0"
								step="60"
								description={m.staff_settings_first_booking_notice_minutes_body()}
							/>
							<FormField
								field={updateReservationSettings.fields.minDurationHours}
								submitAs="text"
								label={m.staff_settings_minimum_duration_hours_label()}
								type="number"
								value={String(reservationSettings.minDurationHours ?? 1)}
								min="0.5"
								step="0.5"
							/>
							<FormField
								field={updateReservationSettings.fields.maxDurationHours}
								submitAs="text"
								label={m.staff_settings_maximum_duration_hours_label()}
								type="number"
								value={String(reservationSettings.maxDurationHours ?? 8)}
								min="1"
								step="1"
							/>
							<FormField
								field={updateReservationSettings.fields.maxAdvanceDaysOneoff}
								submitAs="text"
								label={m.staff_settings_max_advance_booking_one_off_label()}
								type="number"
								value={String(reservationSettings.maxAdvanceDaysOneoff ?? 14)}
								min="1"
							/>
							<FormField
								field={updateReservationSettings.fields.maxAdvanceDaysRecurring}
								submitAs="text"
								label={m.staff_settings_max_advance_booking_recurring_days_label()}
								type="number"
								value={String(reservationSettings.maxAdvanceDaysRecurring ?? 17.5)}
								min="1"
								step="0.5"
							/>
						</div>
					</CardBody>
				</Card>
				<!-- One form, one Save, named for what it saves. The button used to sit
				     in the first card's header while the form wrapped three of them, so
				     editing an operating hour or a social URL offered no save control in
				     the card you were editing (#1076). Three buttons would have been
				     worse: each one saves all of it. -->
				<div class="flex justify-end">
					<SubmitButton
						label={m.staff_settings_save_reservation_settings_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
					/>
				</div>
			</Form>
		{:else if activeTab === 'organization'}
			<p class="text-muted">
				{m.staff_settings_organization_identity_used_emails_branding_text()}
			</p>

			<Form
				remote={updateOrgSettings}
				guard
				successToast={m.staff_settings_organization_settings_updated_toast()}
			>
				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_location_title()}</CardTitle>
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
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_contact_email_title()}</CardTitle>
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
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">{m.staff_settings_social_links_title()}</CardTitle>
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
					</CardBody>
				</Card>
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
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_volunteer_hour_value_title()}</CardTitle>
							<SubmitButton
								label={m.staff_settings_save_label()}
								successLabel={m.staff_settings_saved_label()}
								errorLabel={m.staff_settings_error_label()}
								variant="primary"
								size="sm"
							/>
						</div>
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
					</CardBody>
				</Card>
			</Form>

			<Form
				remote={updateOrientationSettings}
				guard
				successToast={m.staff_settings_orientation_updated_toast()}
			>
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_orientation_title()}</CardTitle>
							<SubmitButton
								label={m.staff_settings_save_label()}
								successLabel={m.staff_settings_saved_label()}
								errorLabel={m.staff_settings_error_label()}
								variant="primary"
								size="sm"
							/>
						</div>
						<p class="text-subtle">
							{m.staff_settings_member_s_first_rehearsal_booking_text()}
						</p>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateOrientationSettings.fields.roleId}
								label={m.staff_settings_role_label()}
								type="select"
								value={orientation.roleId}
								options={[
									{ value: '', label: m.staff_settings_none_label() },
									...orientation.roles.map((r) => ({ value: r.id, label: r.name }))
								]}
							/>
							<FormField
								field={updateOrientationSettings.fields.minutes}
								submitAs="text"
								label={m.staff_settings_length_minutes_label()}
								type="number"
								value={String(orientation.minutes)}
							/>
							<FormField
								field={updateOrientationSettings.fields.leadMinutes}
								submitAs="text"
								label={m.staff_settings_starts_before_booking_minutes_label()}
								type="number"
								value={String(orientation.leadMinutes)}
							/>
						</div>
						<FormField
							field={updateOrientationSettings.fields.tasks}
							label={m.staff_settings_checklist_label()}
							type="textarea"
							description={m.staff_settings_one_task_per_line_body()}
							value={orientation.tasks.join('\n')}
						/>
						<FormField
							field={updateOrientationSettings.fields.firstVisitNotes}
							label={m.staff_settings_first_visit_notes_label()}
							type="textarea"
							description={m.staff_settings_first_visit_notes_body()}
							value={orientation.firstVisitNotes}
						/>
					</CardBody>
				</Card>
			</Form>

			<Form
				remote={updateVenueSettings}
				guard
				successToast={m.staff_settings_room_settings_updated_toast()}
			>
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">{m.staff_settings_room_title()}</CardTitle>
							<SubmitButton
								label={m.staff_settings_save_label()}
								successLabel={m.staff_settings_saved_label()}
								errorLabel={m.staff_settings_error_label()}
								variant="primary"
								size="sm"
							/>
						</div>
						<p class="text-subtle">
							{m.staff_settings_how_many_inputs_desk_can_text()}
						</p>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								field={updateVenueSettings.fields.consoleChannels}
								submitAs="text"
								label={m.staff_settings_console_channels_label()}
								type="number"
								value={String(venue.consoleChannels)}
								placeholder="16"
							/>
						</div>
					</CardBody>
				</Card>
			</Form>
		{:else if activeTab === 'features'}
			<p class="text-muted">
				{m.staff_settings_enable_disable_feature_modules_members_text()}
			</p>

			{#each Object.entries(featureMeta) as [flag, meta] (flag)}
				{@const enabled = featureFlags[flag as FeatureFlag]}
				{@const toggleForm = updateFeatureFlag.for(flag)}
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								{#if enabled}
									<IconToggleRight size={20} class="text-success" />
								{:else}
									<IconToggleLeft size={20} class="opacity-40" />
								{/if}
								<div>
									<h3 class="font-semibold">{meta.label}</h3>
									<p class="text-subtle">{meta.description}</p>
								</div>
							</div>
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
						</div>
					</CardBody>
				</Card>
			{/each}
		{:else if activeTab === 'inbox'}
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
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<ChannelIcon size={20} class="opacity-60" />
								<div>
									<h3 class="font-semibold" data-channel={cfg.channel}>{label}</h3>
									<p class="text-subtle">{meta.description}</p>
								</div>
							</div>
							{#if isAlwaysOn}
								<Badge variant="success">{m.staff_settings_always_label()}</Badge>
							{:else}
								<Form
									remote={toggleForm}
									onsuccess={() =>
										toast.success(`${label} ${cfg.enabled ? 'disabled' : 'enabled'}`)}
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
										{cfg.enabled
											? m.staff_settings_disable_label()
											: m.staff_settings_enable_label()}
									</Button>
								</Form>
							{/if}
						</div>
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
					</CardBody>
				</Card>
			{/each}
		{:else if activeTab === 'subscriptions'}
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
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
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
				</div>

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
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
				</div>
			{/if}
		{/if}
	</div>
</PageContent>
