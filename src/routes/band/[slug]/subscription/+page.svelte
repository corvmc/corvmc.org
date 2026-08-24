<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { formatDate } from '$lib/utils/format';
	import {
		getBandSubscriptionInfo,
		upgradeToPremium,
		cancelPremium,
		resumePremium
	} from '$lib/remote/band-subscription.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { env } from '$env/dynamic/public';
	import { bandSiteUrl, baseDomainFromSiteUrl } from '$lib/utils/band-site-url';
	import { page } from '$app/state';
	import Alert from '$lib/components/shared/Alert.svelte';

	let layout = $derived(await getBandLayout(page.params.slug!));
	let info = $derived(await getBandSubscriptionInfo(page.params.slug!));
	const band = $derived(layout.band);
	const isOwner = $derived(layout.userRole === 'owner');
	const siteUrl = $derived(
		bandSiteUrl(
			band.slug,
			env.PUBLIC_SITE_URL,
			band.customDomainStatus === 'active' ? band.customDomain : null
		)
	);
	const baseDomain = baseDomainFromSiteUrl(env.PUBLIC_SITE_URL);

	// One form object per <form> element — a single object attached to both the
	// monthly and yearly forms throws and takes the whole page down.
	const upgradeMonthly = upgradeToPremium.for('monthly');
	const upgradeYearly = upgradeToPremium.for('yearly');
</script>

<PageHeader title="Subscription" subtitle={band.name} />
<PageContent width="2xl">
	{#if info.tier === 'premium' && info.subscription}
		<!-- Active premium subscription -->
		<Card>
			<CardBody>
				<div class="flex items-center gap-3">
					<CardTitle level={2}>Premium Band Page</CardTitle>
					<Badge variant="success">Active</Badge>
				</div>
				<dl class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
					<div>
						<dt class="font-medium opacity-60">Billing</dt>
						<dd class="capitalize">{info.subscription.billingInterval}</dd>
					</div>
					<div>
						<dt class="font-medium opacity-60">Renews</dt>
						<dd>{formatDate(new Date(info.subscription.currentPeriodEnd))}</dd>
					</div>
					<div class="sm:col-span-2">
						<dt class="font-medium opacity-60">Your site</dt>
						<dd>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- absolute URL on the band's own subdomain, not a route in this app -->
							<a href={siteUrl} target="_blank" rel="noopener" class="link">
								{siteUrl.replace(/^https?:\/\//, '')}
							</a>
						</dd>
					</div>
				</dl>

				{#if info.subscription.cancelAtPeriodEnd}
					<Alert type="warning" class="mt-4">
						Your subscription will end on {formatDate(
							new Date(info.subscription.currentPeriodEnd)
						)}.
					</Alert>
					{#if isOwner}
						<form
							{...resumePremium.enhance(async (form) => {
								try {
									if (await form.submit()) {
										toast.success('Subscription resumed');
										invalidateAll();
									}
								} catch {
									toast.error('Something went wrong');
								}
							})}
						>
							<input {...resumePremium.fields.slug.as('hidden', band.slug)} />
							<Button variant="primary" size="sm" class="mt-2">Resume Subscription</Button>
						</form>
					{/if}
				{:else if isOwner}
					<form
						{...cancelPremium.enhance(async (form) => {
							try {
								if (await form.submit()) {
									toast.success('Subscription will cancel at end of billing period');
									invalidateAll();
								}
							} catch {
								toast.error('Something went wrong');
							}
						})}
					>
						<input {...cancelPremium.fields.slug.as('hidden', band.slug)} />
						<Button variant="ghost" size="sm" class="mt-4 text-error">Cancel Subscription</Button>
					</form>
				{/if}
			</CardBody>
		</Card>
	{:else}
		<!-- Free tier — upgrade CTA -->
		<div class="space-y-6">
			<Card>
				<CardBody class="text-center">
					<h2 class="text-2xl font-bold">Upgrade to Premium</h2>
					<p class="mt-2 opacity-70">
						Your band already has <strong>{band.slug}.{baseDomain}</strong>, pointing at your
						directory profile. Premium turns it into a real website — a block editor, custom CSS,
						genre themes, a full EPK — and lets you serve it from your own domain.
					</p>
				</CardBody>
			</Card>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<!-- Monthly -->
				<div class="card bg-base-100 shadow-sm border">
					<CardBody center>
						<h3 class="text-lg font-bold">Monthly</h3>
						<p class="text-3xl font-bold">
							$15<span class="text-muted font-normal">/mo</span>
						</p>
						{#if isOwner}
							<form
								{...upgradeMonthly.enhance(async (form) => {
									try {
										const result = await form.submit();
										if (result && upgradeMonthly.result?.redirectUrl) {
											// External Stripe Checkout URL — full-page navigation, not client-side routing.
											window.location.href = upgradeMonthly.result.redirectUrl;
										}
									} catch {
										toast.error('Something went wrong');
									}
								})}
							>
								<input {...upgradeMonthly.fields.slug.as('hidden', band.slug)} />
								<input {...upgradeMonthly.fields.billingInterval.as('hidden', 'monthly')} />
								<Button variant="primary" class="mt-4">Subscribe Monthly</Button>
							</form>
						{/if}
					</CardBody>
				</div>

				<!-- Yearly -->
				<div class="card bg-base-100 shadow-sm border border-primary">
					<CardBody center>
						<Badge variant="primary">2 months free</Badge>
						<h3 class="text-lg font-bold">Yearly</h3>
						<p class="text-3xl font-bold">
							$120<span class="text-muted font-normal">/yr</span>
						</p>
						{#if isOwner}
							<form
								{...upgradeYearly.enhance(async (form) => {
									try {
										const result = await form.submit();
										if (result && upgradeYearly.result?.redirectUrl) {
											// External Stripe Checkout URL — full-page navigation, not client-side routing.
											window.location.href = upgradeYearly.result.redirectUrl;
										}
									} catch {
										toast.error('Something went wrong');
									}
								})}
							>
								<input {...upgradeYearly.fields.slug.as('hidden', band.slug)} />
								<input {...upgradeYearly.fields.billingInterval.as('hidden', 'yearly')} />
								<Button variant="primary" class="mt-4">Subscribe Yearly</Button>
							</form>
						{/if}
					</CardBody>
				</div>
			</div>

			<!-- Feature list -->
			<Card>
				<CardBody>
					<h3 class="font-bold">What's included</h3>
					<ul class="mt-2 space-y-2 text-sm">
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Your own domain (theband.com) — or keep using {band.slug}.{baseDomain}
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Block editor with drag-and-drop page building
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Genre-themed templates (Punk, Jazz, Metal, Indie, Electronic, Folk)
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Full custom CSS
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Electronic Press Kit (EPK) with tech rider &amp; stage plot
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Photo gallery with downloadable press images
						</li>
						<li class="flex items-start gap-2">
							<span class="text-success">&#10003;</span>
							Embedded music players (Spotify, SoundCloud, YouTube)
						</li>
					</ul>
				</CardBody>
			</Card>
		</div>
	{/if}
</PageContent>
