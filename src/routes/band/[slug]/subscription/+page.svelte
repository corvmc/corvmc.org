<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import AddCardModal from '$lib/components/member/membership/AddCardModal.svelte';
	import { getBandBilling, startBandAddCard } from '$lib/remote/billing.remote';
	import { invalidateAll } from '$app/navigation';
	import { goToCheckout } from '$lib/utils/checkout-navigation';
	import { formatDate, formatCents } from '$lib/utils/format';
	import {
		getBandSubscriptionInfo,
		upgradeToPremium,
		cancelPremium,
		resumePremium
	} from '$lib/remote/band-subscription.remote';
	import { getBandLayoutContext } from '../layout-context';
	import { env } from '$env/dynamic/public';
	import { bandSiteUrl, baseDomainFromSiteUrl } from '$lib/utils/band-site-url';
	import { page } from '$app/state';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	let info = $derived(await getBandSubscriptionInfo(page.params.slug!));
	const band = $derived(layout.band);
	const isOwner = $derived(layout.userRole === 'owner');
	// An owner who has left the act is precisely the person who cannot fix the
	// card, so an admin has to be able to (#1098).
	const canManageBilling = $derived(isOwner || layout.userRole === 'admin');

	let addCardOpen = $state(false);
	const siteUrl = $derived(
		bandSiteUrl(
			band.slug,
			env.PUBLIC_SITE_URL,
			band.customDomainStatus === 'active' ? band.customDomain : null
		)
	);
	const baseDomain = baseDomainFromSiteUrl(env.PUBLIC_SITE_URL);

	// One form object per <Form> element — a single object attached to both the
	// monthly and yearly forms throws and takes the whole page down.
	const upgradeMonthly = upgradeToPremium.for('monthly');
	const upgradeYearly = upgradeToPremium.for('yearly');

	async function startCheckout(result?: { redirectUrl: string }) {
		if (result?.redirectUrl) await goToCheckout(result.redirectUrl);
	}

	// `?success=true` is the session's `return_url`. The tier is written by
	// `syncFromWebhook`, not by the payment, and premium is now paid for on our
	// own page — so the owner can land here in the same second they confirm and
	// be told they are still on the free tier. Poll, bounded: twenty seconds is
	// longer than the webhook has taken, and the charge stands either way.
	const justPaid = $derived(page.url.searchParams.get('success') === 'true');
	const UPGRADE_RETRY_LIMIT = 10;
	const UPGRADE_RETRY_MS = 2000;
	let upgradeAttempts = $state(0);
	const awaitingUpgrade = $derived(justPaid && info.tier !== 'premium');

	$effect(() => {
		if (!awaitingUpgrade || upgradeAttempts >= UPGRADE_RETRY_LIMIT) return;

		const timer = setTimeout(() => {
			upgradeAttempts += 1;
			void getBandSubscriptionInfo(page.params.slug!).refresh();
		}, UPGRADE_RETRY_MS);

		return () => clearTimeout(timer);
	});
</script>

<PageHeader width="2xl" title={m.band_slug_subscription_title()} subtitle={band.name} />
<PageContent width="2xl">
	{#if awaitingUpgrade}
		<div class="mb-4">
			<Alert type="info">
				{upgradeAttempts >= UPGRADE_RETRY_LIMIT
					? "We haven't had confirmation from our payment processor yet. Your card has been charged and premium switches on as soon as it lands — if this page still says otherwise in a few minutes, get in touch."
					: 'Confirming your payment…'}
			</Alert>
		</div>
	{/if}
	{#if info.tier === 'premium' && info.subscription}
		<!-- Active premium subscription -->
		<Card>
			<CardBody>
				<div class="flex items-center gap-3">
					<CardTitle level={2}>{m.band_slug_subscription_premium_band_page()}</CardTitle>
					<Badge variant="success">{m.band_slug_subscription_active()}</Badge>
				</div>
				<DefinitionList class="mt-4">
					<Fact label={m.band_slug_subscription_billing()}>
						<span class="capitalize">{info.subscription.billingInterval}</span>
					</Fact>
					<Fact label={m.band_slug_subscription_renews()}
						>{formatDate(new Date(info.subscription.currentPeriodEnd))}</Fact
					>
					<Fact label={m.band_slug_subscription_site()}>
						<!-- The band's own subdomain, so this leaves the app: rel="external" is
						     both the correct annotation and what keeps it out of the router. -->
						<a href={siteUrl} target="_blank" rel="external noopener" class="link">
							{siteUrl.replace(/^https?:\/\//, '')}
						</a>
					</Fact>
				</DefinitionList>

				{#if info.subscription.cancelAtPeriodEnd}
					<Alert type="warning" class="mt-4">
						{m.band_slug_subscription_subscription_will_end({
							formatDate: formatDate(new Date(info.subscription.currentPeriodEnd))
						})}
					</Alert>
					{#if isOwner}
						<Form
							remote={resumePremium}
							successToast={m.band_slug_subscription_subscription_resumed()}
							onsuccess={() => invalidateAll()}
						>
							<input {...resumePremium.fields.slug.as('hidden', band.slug)} />
							<SubmitButton
								label={m.band_slug_subscription_resume_subscription()}
								variant="primary"
								size="sm"
								class="mt-2"
							/>
						</Form>
					{/if}
				{:else if isOwner}
					<Form
						remote={cancelPremium}
						successToast={m.band_slug_subscription_subscription_will_cancel_at_end()}
						onsuccess={() => invalidateAll()}
					>
						<input {...cancelPremium.fields.slug.as('hidden', band.slug)} />
						<SubmitButton
							label={m.band_slug_subscription_cancel_subscription()}
							variant="ghost"
							size="sm"
							class="mt-4 text-error"
						/>
					</Form>
				{/if}
			</CardBody>
		</Card>

		<!--
			Whose card this is, and a way to change it. The band's customer carried
			whatever the owner typed at checkout, with nothing showing it and no way
			to replace it — so an act kept billing whoever set it up after they
			left, and an expired card meant premium lapsed with no self-service fix
			(#1098). Admins too, not just the owner: an owner who has left is
			exactly who cannot fix it.
		-->
		{#if canManageBilling}
			<!-- eslint-disable-next-line custom/no-interactive-await -- #2359 -->
			{#await getBandBilling(band.slug) then billing}
				<Card>
					<CardBody>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<CardTitle size="base">{m.band_slug_subscription_card_file()}</CardTitle>
							<Button
								type="button"
								variant="default"
								size="sm"
								outline
								onclick={() => (addCardOpen = true)}
							>
								{billing.cards.length > 0 ? 'Replace card' : 'Add a card'}
							</Button>
						</div>

						{#if !billing.available}
							<p class="text-muted">
								{m.band_slug_subscription_we_could_not_reach_our()}
							</p>
						{:else if billing.cards.length === 0}
							<p class="text-muted">
								{m.band_slug_subscription_no_card_saved_act_renewals()}
							</p>
						{:else}
							{#each billing.cards as card (card.id)}
								<p class="text-sm">
									<span class="font-medium">{card.brand.toUpperCase()} ···· {card.last4}</span>
									<span class="text-muted">
										expires {card.expMonth}/{card.expYear}{card.isDefault ? ' · billed' : ''}
									</span>
								</p>
							{/each}
							<p class="mt-2 text-muted">
								{m.band_slug_subscription_band_s_card_not_member()}
							</p>
						{/if}

						<AddCardModal
							bind:open={addCardOpen}
							driver={billing.driver}
							start={() => startBandAddCard(band.slug)}
							onsaved={() => getBandBilling(band.slug).refresh()}
						/>
					</CardBody>
				</Card>
			{/await}
		{/if}
	{:else}
		<!-- Free tier — upgrade CTA -->
		<div class="space-y-6">
			<Card>
				<CardBody class="text-center">
					<h2 class="text-2xl font-bold">{m.band_upgrade_premium()}</h2>
					<p class="mt-2 opacity-70">
						<ParaglideMessage
							message={m.band_slug_subscription_band_already_has_pointing_at}
							inputs={{ slug: band.slug, baseDomain }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				</CardBody>
			</Card>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<!-- Monthly -->
				<Card class="border">
					<CardBody center>
						<h3 class="text-lg font-bold">{m.band_slug_subscription_monthly()}</h3>
						<p class="text-3xl font-bold">
							{formatCents(info.pricing.monthlyCents)}<span class="text-muted font-normal"
								>{m.band_slug_subscription_mo()}</span
							>
						</p>
						{#if isOwner}
							<Form remote={upgradeMonthly} onsuccess={startCheckout}>
								<input {...upgradeMonthly.fields.slug.as('hidden', band.slug)} />
								<input {...upgradeMonthly.fields.billingInterval.as('hidden', 'monthly')} />
								<SubmitButton
									label={m.band_slug_subscription_subscribe_monthly()}
									variant="primary"
									class="mt-4"
								/>
							</Form>
						{/if}
					</CardBody>
				</Card>

				<!-- Yearly -->
				<Card class="border border-primary">
					<CardBody center>
						<Badge variant="primary">
							{m.band_slug_subscription_months_free({
								yearlyMonthsFree: info.pricing.yearlyMonthsFree
							})}
						</Badge>
						<h3 class="text-lg font-bold">{m.band_slug_subscription_yearly()}</h3>
						<p class="text-3xl font-bold">
							{formatCents(info.pricing.yearlyCents)}<span class="text-muted font-normal"
								>{m.band_slug_subscription_yr()}</span
							>
						</p>
						{#if isOwner}
							<Form remote={upgradeYearly} onsuccess={startCheckout}>
								<input {...upgradeYearly.fields.slug.as('hidden', band.slug)} />
								<input {...upgradeYearly.fields.billingInterval.as('hidden', 'yearly')} />
								<SubmitButton
									label={m.band_slug_subscription_subscribe_yearly()}
									variant="primary"
									class="mt-4"
								/>
							</Form>
						{/if}
					</CardBody>
				</Card>
			</div>

			<!-- Feature list -->
			<Card>
				<CardBody>
					<h3 class="font-bold">{m.band_slug_subscription_what_s_included()}</h3>
					<ul class="mt-2 space-y-2 text-sm">
						<li class="flex items-start gap-2">
							<ParaglideMessage
								message={m.band_slug_subscription_own_domain_keep_using}
								inputs={{ slug: band.slug, baseDomain }}
								>{#snippet span({ children })}<span class="text-success"
										>{@render children?.()}</span
									>{/snippet}</ParaglideMessage
							>
						</li>
						<li class="flex items-start gap-2">
							<ParaglideMessage
								message={m.band_slug_subscription_page_arrives_already_built_reorder}
								inputs={{}}
								>{#snippet span({ children })}<span class="text-success"
										>{@render children?.()}</span
									>{/snippet}</ParaglideMessage
							>
						</li>
						<li class="flex items-start gap-2">
							<ParaglideMessage
								message={m.band_slug_subscription_genre_themed_templates_punk_jazz}
								inputs={{}}
								>{#snippet span({ children })}<span class="text-success"
										>{@render children?.()}</span
									>{/snippet}</ParaglideMessage
							>
						</li>
						<li class="flex items-start gap-2">
							<ParaglideMessage message={m.band_slug_subscription_full_custom_css} inputs={{}}
								>{#snippet span({ children })}<span class="text-success"
										>{@render children?.()}</span
									>{/snippet}</ParaglideMessage
							>
						</li>
						<!-- The EPK, the embedded player and one press photo are free for
						     every act now, so selling them here would be selling something
						     the band already has. What premium adds is presentation and
						     volume. -->
						<li class="flex items-start gap-2">
							<ParaglideMessage
								message={m.band_slug_subscription_video_section_live_clips_page}
								inputs={{}}
								>{#snippet span({ children })}<span class="text-success"
										>{@render children?.()}</span
									>{/snippet}</ParaglideMessage
							>
						</li>
						<li class="flex items-start gap-2">
							<ParaglideMessage
								message={m.band_slug_subscription_unlimited_press_photos_instead_one}
								inputs={{}}
								>{#snippet span({ children })}<span class="text-success"
										>{@render children?.()}</span
									>{/snippet}</ParaglideMessage
							>
						</li>
					</ul>
				</CardBody>
			</Card>
		</div>
	{/if}
</PageContent>
