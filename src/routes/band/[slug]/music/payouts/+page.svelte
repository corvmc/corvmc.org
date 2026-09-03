<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import {
		getBandPayouts,
		startPayoutOnboarding,
		openPayoutDashboard
	} from '$lib/remote/audio.remote';
	import { getBandLayoutContext } from '../../layout-context';
	import { AUDIO_PLATFORM_FEE_BPS } from '$lib/config';
	import { page } from '$app/state';

	const bandLayout = getBandLayoutContext();
	const band = $derived(bandLayout.current.band);
	const slug = $derived(page.params.slug!);

	const payouts = $derived(await getBandPayouts(slug));

	/**
	 * Stripe's account links are single-use and expire in minutes, so the browser
	 * is sent off the moment the URL comes back rather than the link being
	 * rendered — a URL sitting in the page is one a back button can replay dead.
	 */
	function goToStripe(result: unknown) {
		const url = (result as { url?: string } | undefined)?.url;
		if (url) window.location.href = url;
	}

	const suggested = (AUDIO_PLATFORM_FEE_BPS / 100).toFixed(0);
</script>

<PageHeader title="Payouts" subtitle={band.name} />

<PageContent width="2xl">
	<Card>
		<CardBody>
			<CardTitle>
				Stripe
				{#if payouts.chargesEnabled}
					<Badge variant="success" size="sm">Ready</Badge>
				{:else if payouts.connected}
					<Badge variant="warning" size="sm">Unfinished</Badge>
				{:else}
					<Badge variant="ghost" size="sm">Not set up</Badge>
				{/if}
			</CardTitle>

			{#if payouts.chargesEnabled}
				<p class="text-muted">
					Sales go straight to your own Stripe account on its own payout schedule — the collective
					never holds your money. Bank details and payout history live in Stripe.
				</p>
				<Form remote={openPayoutDashboard} onsuccess={goToStripe}>
					{@const fields = openPayoutDashboard.fields}
					<input {...fields.slug.as('hidden', slug)} />
					<SubmitButton variant="ghost" label="Open Stripe dashboard" />
				</Form>
			{:else}
				<p class="text-muted">
					To sell a release you need a Stripe account of your own. Stripe collects the details it
					needs to pay you and to handle your tax forms; the collective never sees your bank
					information.
				</p>

				{#if payouts.requirementsDue.length > 0}
					<!-- Stripe's own list, verbatim. "Finish setting up" with no idea
					     what is missing is the reason people abandon this. -->
					<Alert type="warning">
						Stripe still needs: {payouts.requirementsDue.join(', ')}
					</Alert>
				{/if}

				<Form remote={startPayoutOnboarding} onsuccess={goToStripe}>
					{@const fields = startPayoutOnboarding.fields}
					<input {...fields.slug.as('hidden', slug)} />
					<SubmitButton
						label={payouts.connected ? 'Finish setting up payouts' : 'Set up payouts'}
					/>
				</Form>
			{/if}
		</CardBody>
	</Card>

	<Card>
		<CardBody>
			<CardTitle>What the collective takes</CardTitle>
			<p class="text-muted">
				{suggested}% is <em>suggested</em>, not fixed. Buyers see the split before they pay and can
				move it — down to nothing, or up. Card processing comes out of your share unless the buyer
				chooses to cover it, in which case you keep the full amount.
			</p>
			<p class="text-muted">
				Free releases skip all of this. A record priced at nothing needs no Stripe account and can
				still go out on CMC Radio.
			</p>
		</CardBody>
	</Card>
</PageContent>
