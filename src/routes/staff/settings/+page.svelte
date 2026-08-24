<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import {
		getProducts,
		updateProduct,
		getReservationSettings,
		updateReservationSettings,
		getOrgSettings,
		updateOrgSettings,
		getIntegrationSettings,
		updateIntegrationSettings,
		testUtecConnection,
		runLockSelfTest,
		revokeLockTest,
		getFeatureFlags,
		updateFeatureFlag,
		syncSubscriptions,
		refreshCommunityStats
	} from '$lib/remote/settings.remote';
	import { getInboxChannelConfigs, updateInboxChannelConfig } from '$lib/remote/inbox.remote';
	import { isAlwaysEnabledChannel } from '$lib/config';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import StatCard from '$lib/components/shared/StatCard.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import type { SubscriptionSyncSummary } from '$lib/types/subscription-sync';
	import type { CommunityStats } from '$lib/server/db/schema/finance';
	import { formatDollars } from '$lib/utils/format';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		IconPlugConnected,
		IconCircleCheck,
		IconCircleX,
		IconCopy,
		IconMail,
		IconMessageCircle,
		IconWorld,
		IconMessages,
		IconBrandInstagram,
		IconBrandFacebook,
		IconToggleRight,
		IconToggleLeft
	} from '@tabler/icons-svelte';

	let activeTab = $state('pricing');
	let products = $derived(await getProducts());
	let reservationSettings = $derived(await getReservationSettings());
	let orgSettings = $derived(await getOrgSettings());
	let integrationSettings = $derived(await getIntegrationSettings());
	let channelConfigs = $derived(await getInboxChannelConfigs());
	let featureFlags = $derived(await getFeatureFlags());

	const { fields: reservationFields } = updateReservationSettings;

	let connectionTestResult = $state<{ ok: boolean; error?: string } | null>(null);
	let connectionTesting = $state(false);

	let selfTestResult = $state<Awaited<ReturnType<typeof runLockSelfTest>> | null>(null);
	let selfTesting = $state(false);
	let revokingTest = $state(false);

	// U-tec is "connected" once a refresh token has been minted (via OAuth or
	// pasted manually). Until then, only the Connect flow makes sense.
	const utecConnected = $derived(!!integrationSettings.refreshToken);
	const utecCanConnect = $derived(
		!!integrationSettings.clientId && !!integrationSettings.clientSecret
	);
	const utecRedirectUri = $derived(`${page.url.origin}/api/integrations/utec/callback`);

	// Surface the result of the OAuth round-trip (?utec=… set by the callback).
	$effect(() => {
		const result = page.url.searchParams.get('utec');
		if (!result) return;
		activeTab = 'integrations';

		const messages: Record<string, [type: 'success' | 'error', msg: string]> = {
			connected: ['success', 'Connected to U-tec.'],
			denied: ['error', 'Authorization was declined.'],
			state_error: ['error', 'Security check failed — please try connecting again.'],
			exchange_failed: ['error', 'Could not complete the connection. Check the credentials.'],
			missing_config: ['error', 'Enter and save the Client ID and Secret first.']
		};
		const m = messages[result];
		if (m) toast[m[0]](m[1]);

		replaceState(resolve('/staff/settings'), {});
	});

	const tabs = [
		{ key: 'pricing', label: 'Pricing' },
		{ key: 'reservations', label: 'Reservations' },
		{ key: 'organization', label: 'Organization' },
		{ key: 'integrations', label: 'Integrations' },
		{ key: 'inbox', label: 'Inbox Channels' },
		{ key: 'features', label: 'Features' },
		{ key: 'subscriptions', label: 'Subscriptions' }
	];

	let syncResult = $state<SubscriptionSyncSummary | null>(null);
	let statsResult = $state<CommunityStats | null>(null);

	const featureMeta: Record<string, { label: string; description: string }> = {
		staffInbox: {
			label: 'Staff Inbox',
			description: 'Multi-channel unified inbox for email, SMS, and web messages'
		},
		bandPremium: {
			label: 'Band Premium',
			description: 'Premium tier with page editor, EPK, and public band sites'
		},
		emailMarketing: {
			label: 'Email Marketing',
			description: 'Audience management, campaigns, and broadcast emails'
		},
		equipment: {
			label: 'Equipment',
			description: 'Equipment catalog, loan management, and equipment credits'
		},
		helpArticles: {
			label: 'Help Articles',
			description: 'Knowledge base with staff-managed articles for members'
		},
		contentFlags: {
			label: 'Content Flags',
			description: 'Lets members report profiles and gives staff a moderation queue'
		},
		volunteering: {
			label: 'Volunteering',
			description: 'Volunteer roles, member hour logging, and a staff approval queue'
		}
	};

	const channelMeta: Record<
		string,
		{ label: string; icon: typeof IconMail; description: string; envHint: string }
	> = {
		email: {
			label: 'Email',
			icon: IconMail,
			description: 'Receive and reply to emails via Postmark',
			envHint: 'POSTMARK_SERVER_TOKEN, POSTMARK_INBOUND_TOKEN'
		},
		sms: {
			label: 'SMS',
			icon: IconMessageCircle,
			description: 'Send and receive text messages via Twilio',
			envHint: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER'
		},
		web: {
			label: 'Contact Form',
			icon: IconWorld,
			description: 'Receive messages from the public contact form',
			envHint: 'Always enabled'
		},
		portal: {
			label: 'Member Portal',
			icon: IconMessages,
			description: 'Members message staff from their member portal',
			envHint: 'Always enabled'
		},
		instagram: {
			label: 'Instagram DMs',
			icon: IconBrandInstagram,
			description: 'Receive and reply to Instagram direct messages',
			envHint: 'META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN'
		},
		messenger: {
			label: 'Messenger',
			icon: IconBrandFacebook,
			description: 'Receive and reply to Facebook Messenger messages',
			envHint: 'META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN'
		}
	};

	async function handleTestConnection() {
		connectionTesting = true;
		connectionTestResult = null;
		try {
			connectionTestResult = await testUtecConnection();
		} finally {
			connectionTesting = false;
		}
	}

	async function handleSelfTest() {
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

	async function handleRevokeTest() {
		revokingTest = true;
		try {
			const { removed } = await revokeLockTest();
			selfTestResult = null;
			toast.success(removed > 0 ? `Removed ${removed} test code(s)` : 'No test codes to remove');
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			revokingTest = false;
		}
	}
</script>

<PageHeader title="Settings" subtitle="Staff" />

<PageContent width="2xl">
	<TabBar {tabs} active={activeTab} onchange={(key) => (activeTab = key)} />

	<div class="mt-6 space-y-4">
		{#if activeTab === 'pricing'}
			<p class="text-muted">
				Configure the products and pricing used for checkout. Changes to names and descriptions sync
				to Stripe automatically. Price changes take effect on the next checkout.
			</p>

			{#each products as product (product.key)}
				{@const isFee = product.key === 'fee_coverage'}
				{@const instance = updateProduct.for(product.key)}
				<Form remote={instance} successToast="{product.name} updated">
					<Card>
						<CardBody>
							<div class="flex items-center justify-between">
								<CardTitle size="base">{product.name}</CardTitle>
								<SubmitButton
									label="Save"
									successLabel="Saved"
									errorLabel="Error"
									variant="primary"
									size="sm"
								/>
							</div>

							{#if product.stripeProductId}
								<p class="font-mono text-xs opacity-50">{product.stripeProductId}</p>
							{:else}
								<p class="text-xs opacity-50">Stripe product will be created on first checkout</p>
							{/if}

							<input {...instance.fields.key.as('hidden', product.key)} />

							<div class="mt-2 grid gap-4 sm:grid-cols-2">
								<div class="form-control">
									<label class="label" for="name-{product.key}">
										<span class="label-text">Product name</span>
									</label>
									{#each instance.fields.name.issues() ?? [] as issue (issue.message)}
										<p class="text-sm text-error">{issue.message}</p>
									{/each}
									<input
										id="name-{product.key}"
										name="name"
										type="text"
										value={product.name}
										class="input input-sm"
									/>
								</div>

								{#if !isFee}
									<div class="form-control">
										<label class="label" for="amount-{product.key}">
											<span class="label-text">
												Amount ({product.unitLabel ?? 'per unit'})
											</span>
										</label>
										{#each instance.fields.unitAmountCents.issues() ?? [] as issue (issue.message)}
											<p class="text-sm text-error">{issue.message}</p>
										{/each}
										<label class="input input-sm flex items-center gap-1">
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
														?.querySelector<HTMLInputElement>('[name="unitAmountCents"]');
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

							<div class="form-control mt-2">
								<label class="label" for="desc-{product.key}">
									<span class="label-text">Description</span>
								</label>
								<textarea
									id="desc-{product.key}"
									name="description"
									value={product.description ?? ''}
									class="textarea textarea-sm"
									rows="2"
								></textarea>
							</div>
						</CardBody>
					</Card>
				</Form>
			{/each}
		{:else if activeTab === 'reservations'}
			<p class="text-muted">
				Configure operating hours, booking rules, and scheduling limits for practice room
				reservations.
			</p>

			<Form remote={updateReservationSettings} guard successToast="Reservation settings updated">
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">Pricing</CardTitle>
							<SubmitButton
								label="Save"
								successLabel="Saved"
								errorLabel="Error"
								variant="primary"
								size="sm"
							/>
						</div>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<div class="form-control">
								<label class="label" for="hourlyRate">
									<span class="label-text">Hourly rate</span>
								</label>
								<label class="input input-sm flex items-center gap-1">
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
												?.querySelector<HTMLInputElement>('[name="hourlyRateCents"]');
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
							<CardTitle size="base">Operating Hours</CardTitle>
						</div>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								name="operatingHoursStart"
								label="Opens at"
								type="time"
								value={String(reservationSettings.operatingHoursStart ?? '09:00')}
							/>
							<FormField
								name="operatingHoursEnd"
								label="Closes at"
								type="time"
								value={String(reservationSettings.operatingHoursEnd ?? '22:00')}
							/>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">Booking Rules</CardTitle>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								name="timeSlotMinutes"
								label="Time slot granularity"
								type="select"
								value={String(reservationSettings.timeSlotMinutes ?? 30)}
								options={[
									{ value: '15', label: '15 minutes' },
									{ value: '30', label: '30 minutes' },
									{ value: '60', label: '60 minutes' }
								]}
							/>
							<FormField
								name="bufferMinutes"
								label="Buffer between reservations (min)"
								type="number"
								value={String(reservationSettings.bufferMinutes ?? 0)}
								min="0"
								step="5"
							/>
							<FormField
								name="minAdvanceMinutes"
								label="Min advance booking (minutes)"
								type="number"
								value={String(reservationSettings.minAdvanceMinutes ?? 60)}
								min="0"
								step="15"
							/>
							<FormField
								name="minDurationHours"
								label="Minimum duration (hours)"
								type="number"
								value={String(reservationSettings.minDurationHours ?? 1)}
								min="0.5"
								step="0.5"
							/>
							<FormField
								name="maxDurationHours"
								label="Maximum duration (hours)"
								type="number"
								value={String(reservationSettings.maxDurationHours ?? 8)}
								min="1"
								step="1"
							/>
							<FormField
								name="maxAdvanceDaysOneoff"
								label="Max advance booking — one-off (days)"
								type="number"
								value={String(reservationSettings.maxAdvanceDaysOneoff ?? 14)}
								min="1"
							/>
							<FormField
								name="maxAdvanceDaysRecurring"
								label="Max advance booking — recurring (days)"
								type="number"
								value={String(reservationSettings.maxAdvanceDaysRecurring ?? 17.5)}
								min="1"
								step="0.5"
							/>
						</div>
					</CardBody>
				</Card>
			</Form>
		{:else if activeTab === 'organization'}
			<p class="text-muted">
				Organization identity used in emails, branding, and member-facing content.
			</p>

			<Form remote={updateOrgSettings} guard successToast="Organization settings updated">
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<CardTitle size="base">Organization Info</CardTitle>
							<SubmitButton
								label="Save"
								successLabel="Saved"
								errorLabel="Error"
								variant="primary"
								size="sm"
							/>
						</div>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								name="name"
								label="Organization name"
								type="text"
								value={String(orgSettings.name ?? 'Corvallis Music Collective')}
							/>
							<FormField
								name="shortName"
								label="Short name"
								type="text"
								value={String(orgSettings.shortName ?? 'CorvMC')}
								description="Used in navigation and email subjects"
							/>
							<FormField
								name="contactEmail"
								label="Staff contact email"
								type="email"
								value={String(orgSettings.contactEmail ?? 'staff@corvmc.org')}
							/>
							<FormField
								name="timezone"
								label="Timezone"
								type="select"
								value={String(orgSettings.timezone ?? 'America/Los_Angeles')}
								options={[
									{ value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
									{ value: 'America/Denver', label: 'Mountain (Denver)' },
									{ value: 'America/Chicago', label: 'Central (Chicago)' },
									{ value: 'America/New_York', label: 'Eastern (New York)' },
									{ value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
									{ value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' }
								]}
							/>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">Location</CardTitle>
						<p class="text-subtle">Shown in the site footer and on the contact page.</p>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								name="addressStreet"
								label="Street address"
								type="text"
								value={String(orgSettings.addressStreet ?? '')}
								placeholder="6775 SW Philomath Blvd"
							/>
							<FormField
								name="addressCity"
								label="City"
								type="text"
								value={String(orgSettings.addressCity ?? '')}
								placeholder="Corvallis"
							/>
							<FormField
								name="addressState"
								label="State"
								type="text"
								value={String(orgSettings.addressState ?? '')}
								placeholder="OR"
							/>
							<FormField
								name="addressZip"
								label="ZIP"
								type="text"
								value={String(orgSettings.addressZip ?? '')}
								placeholder="97333"
							/>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardBody>
						<CardTitle size="base">Social Links</CardTitle>
						<p class="text-subtle">Shown in the site footer. Leave blank to hide.</p>

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								name="socialFacebook"
								label="Facebook URL"
								type="text"
								value={String(orgSettings.socialFacebook ?? '')}
								placeholder="https://facebook.com/..."
							/>
							<FormField
								name="socialInstagram"
								label="Instagram URL"
								type="text"
								value={String(orgSettings.socialInstagram ?? '')}
								placeholder="https://instagram.com/..."
							/>
						</div>
					</CardBody>
				</Card>
			</Form>
		{:else if activeTab === 'integrations'}
			<p class="text-muted">
				Manage credentials for third-party integrations. Changes take effect immediately.
			</p>

			<Form remote={updateIntegrationSettings} guard successToast="U-tec credentials updated">
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<CardTitle size="base">U-tec Smart Lock</CardTitle>
								<span class="badge badge-sm {utecConnected ? 'badge-success' : 'badge-ghost'}">
									{utecConnected ? 'Connected' : 'Not connected'}
								</span>
							</div>
							<div class="flex gap-2">
								{#if utecConnected}
									<!-- Test Connection only matters once a refresh token exists. -->
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onclick={handleTestConnection}
										disabled={connectionTesting}
									>
										{#if connectionTesting}
											<span class="loading loading-spinner loading-xs"></span>
										{:else}
											<IconPlugConnected class="size-4" />
										{/if}
										Test Connection
									</Button>
									<Button
										href={resolve('/api/integrations/utec/authorize')}
										variant="ghost"
										size="sm"
										data-sveltekit-reload
									>
										Reconnect
									</Button>
								{:else}
									<Button
										href={resolve('/api/integrations/utec/authorize')}
										variant="primary"
										size="sm"
										class={utecCanConnect ? '' : 'btn-disabled'}
										data-sveltekit-reload
									>
										<IconPlugConnected class="size-4" />
										Connect to U-tec
									</Button>
								{/if}
								<SubmitButton
									label="Save"
									successLabel="Saved"
									errorLabel="Error"
									variant="primary"
									size="sm"
								/>
							</div>
						</div>

						{#if !utecConnected && !utecCanConnect}
							<p class="text-subtle">
								Enter and save your Client ID and Secret, then connect to authorize the lock.
							</p>
						{/if}

						{#if connectionTestResult}
							<div
								class="alert {connectionTestResult.ok
									? 'alert-success'
									: 'alert-error'} py-2 text-sm"
							>
								{#if connectionTestResult.ok}
									Connection successful — token refresh verified.
								{:else}
									Connection failed: {connectionTestResult.error}
								{/if}
							</div>
						{/if}

						{#if utecConnected}
							<div class="mt-2 border-t border-base-200 pt-3">
								<div class="flex items-start justify-between gap-2">
									<div>
										<p class="text-sm font-medium">Lock self-test</p>
										<p class="text-subtle">
											Issues a 15-minute test code and exercises the lock commands. Try the code on
											the door, then revoke it.
										</p>
									</div>
									<div class="flex shrink-0 gap-2">
										<Button
											type="button"
											variant="default"
											size="sm"
											outline
											onclick={handleSelfTest}
											disabled={selfTesting}
										>
											{#if selfTesting}
												<span class="loading loading-spinner loading-xs"></span>
											{/if}
											Run lock self-test
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onclick={handleRevokeTest}
											disabled={revokingTest}
										>
											{#if revokingTest}
												<span class="loading loading-spinner loading-xs"></span>
											{/if}
											Revoke test codes
										</Button>
									</div>
								</div>

								{#if selfTestResult}
									<div class="mt-3 rounded-lg border border-base-300 p-3">
										{#if selfTestResult.code}
											<div class="mb-2 flex items-baseline gap-2">
												<span class="text-subtle">Test code</span>
												<span class="font-mono text-2xl font-bold tracking-[0.2em]">
													{selfTestResult.code}
												</span>
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
									</div>
								{/if}
							</div>
						{/if}

						<div class="mt-2 grid gap-4 sm:grid-cols-2">
							<FormField
								name="clientId"
								label="Client ID"
								type="text"
								value={integrationSettings.clientId}
							/>
							<FormField
								name="clientSecret"
								label="Client Secret"
								type="password"
								value={integrationSettings.clientSecret}
							/>
							<FormField
								name="deviceId"
								label="Device ID"
								type="text"
								value={integrationSettings.deviceId}
							/>
							<FormField
								name="refreshToken"
								label="Refresh Token"
								type="password"
								value={integrationSettings.refreshToken}
							/>
						</div>

						<div class="mt-2">
							<p class="text-subtle">
								Redirect URI — register this exact value in the U-tec developer console:
							</p>
							<div class="mt-1 flex items-center gap-2">
								<code class="flex-1 truncate rounded bg-base-200 px-2 py-1 font-mono text-xs">
									{utecRedirectUri}
								</code>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									title="Copy redirect URI"
									onclick={() => {
										navigator.clipboard.writeText(utecRedirectUri);
										toast.success('Redirect URI copied');
									}}
								>
									<IconCopy class="size-3.5" />
								</Button>
							</div>
						</div>

						<p class="mt-2 text-xs opacity-50">
							Click "Connect to U-tec" to authorize and fill the Refresh Token automatically, or set
							credentials via environment variables (ULTRALOC_CLIENT_ID, etc.). Values saved here
							take precedence over environment variables.
						</p>
					</CardBody>
				</Card>
			</Form>
		{:else if activeTab === 'features'}
			<p class="text-muted">
				Enable or disable feature modules for members, bands and the public site. Disabled features
				are hidden from member navigation and return 404 if accessed directly. The staff panel
				always shows every feature, so you can set one up here before switching it on for everyone.
			</p>

			{#each Object.entries(featureMeta) as [flag, meta] (flag)}
				{@const enabled = featureFlags[flag as keyof typeof featureFlags]}
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
							<form
								{...toggleForm.enhance(async ({ submit }) => {
									if (await submit()) {
										toast.success(`${meta.label} ${enabled ? 'disabled' : 'enabled'}`);
									}
								})}
							>
								<input {...toggleForm.fields.flag.as('hidden', flag)} />
								<input {...toggleForm.fields.enabled.as('hidden', enabled ? 'false' : 'true')} />
								<Button
									type="submit"
									variant={enabled ? 'error' : 'success'}
									outline={enabled}
									size="sm"
								>
									{enabled ? 'Disable' : 'Enable'}
								</Button>
							</form>
						</div>
					</CardBody>
				</Card>
			{/each}
		{:else if activeTab === 'inbox'}
			<p class="text-muted">
				Enable or disable communication channels for the staff inbox. Disabled channels won't
				receive or send messages. Environment variables must be configured for each channel to
				function.
			</p>

			{#each channelConfigs as cfg (cfg.channel)}
				{@const meta = channelMeta[cfg.channel]}
				{@const isAlwaysOn = isAlwaysEnabledChannel(cfg.channel)}
				{@const ChannelIcon = meta.icon}
				{@const toggleForm = updateInboxChannelConfig.for(cfg.channel)}
				<Card>
					<CardBody>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<ChannelIcon size={20} class="opacity-60" />
								<div>
									<h3 class="font-semibold">{meta.label}</h3>
									<p class="text-subtle">{meta.description}</p>
								</div>
							</div>
							{#if isAlwaysOn}
								<span class="badge badge-success badge-sm">Always On</span>
							{:else}
								<form
									{...toggleForm.enhance(async ({ submit }) => {
										if (await submit()) {
											toast.success(`${meta.label} ${cfg.enabled ? 'disabled' : 'enabled'}`);
										}
									})}
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
										{cfg.enabled ? 'Disable' : 'Enable'}
									</Button>
								</form>
							{/if}
						</div>
						{#if !isAlwaysOn}
							<div class="mt-2 text-xs opacity-40">
								Env: {meta.envHint}
							</div>
						{/if}
					</CardBody>
				</Card>
			{/each}
		{:else if activeTab === 'subscriptions'}
			<p class="text-muted">
				Reconciles every member and band subscription status from Stripe into the local database.
				Use this as a one-time backfill after migration, or any time to re-sync if a webhook was
				missed. For active members it also tops up any missing monthly credits by replaying their
				latest paid invoice — it never reduces a balance already spent down this month, and leaves
				canceled members' credits untouched.
			</p>

			<Action
				label="Sync now"
				successLabel="Synced"
				successToast="Subscriptions synced from Stripe"
				action={async () => {
					syncResult = await syncSubscriptions();
				}}
			/>

			{#if syncResult}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
					<StatCard title="Scanned" value={syncResult.totalScanned} />
					<StatCard title="Users updated" value={syncResult.usersUpdated} />
					<StatCard title="Users cleared" value={syncResult.usersCleared} />
					<StatCard title="Credits reconciled" value={syncResult.creditsReconciled} />
					<StatCard title="Bands updated" value={syncResult.bandsUpdated} />
					<StatCard title="Bands cleared" value={syncResult.bandsCleared} />
					<StatCard title="Skipped" value={syncResult.skipped} />
				</div>

				{#if syncResult.errors.length > 0}
					<Alert type="warning">
						<p class="font-semibold">{syncResult.errors.length} record(s) had issues:</p>
						<ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm">
							{#each syncResult.errors as err, i (i)}
								<li>
									<span class="badge badge-ghost badge-sm">{err.kind}</span>
									{err.message}{err.ref ? ` (${err.ref})` : ''}
								</li>
							{/each}
						</ul>
					</Alert>
				{/if}
			{/if}

			<div class="divider"></div>

			<p class="text-muted">
				Community impact stats (sustaining members, free hours funded, participation) are cached for
				24 hours. Refresh to recompute them now from current subscriptions — useful right after a
				sync.
			</p>

			<Action
				label="Refresh stats"
				successLabel="Refreshed"
				successToast="Community stats refreshed"
				action={async () => {
					statsResult = await refreshCommunityStats();
				}}
			/>

			{#if statsResult}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<StatCard title="Sustaining members" value={statsResult.sustainingMemberCount} />
					<StatCard title="Free hours / month" value={statsResult.totalFreeHoursAllocated} />
					<StatCard title="Participation" value={`${statsResult.participationPercent}%`} />
				</div>
			{/if}
		{/if}
	</div>
</PageContent>
