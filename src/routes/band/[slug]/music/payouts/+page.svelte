<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		getBandPayouts,
		startPayoutOnboarding,
		openPayoutDashboard
	} from '#lib/remote/audio.remote.js';
	import { getBandLayoutContext } from '../../layout-context';
	import { AUDIO_PLATFORM_FEE_BPS } from '#lib/config.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug');

	const bandLayout = getBandLayoutContext();
	const band = $derived(bandLayout.current.band);
	const slug = $derived(params.slug);

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

<PageHeader width="2xl" title={m.band_slug_music_payouts_title()} subtitle={band.name} />

<PageContent width="2xl">
	<Card>
		<CardBody>
			<CardTitle>
				{m.band_slug_music_payouts_stripe_title()}
				{#if payouts.chargesEnabled}
					<Badge variant="success" size="sm">{m.band_slug_music_payouts_ready_label()}</Badge>
				{:else if payouts.connected}
					<Badge variant="warning" size="sm">{m.band_slug_music_payouts_unfinished_label()}</Badge>
				{:else}
					<Badge variant="ghost" size="sm">{m.band_slug_music_payouts_not_set_up_label()}</Badge>
				{/if}
			</CardTitle>

			{#if payouts.chargesEnabled}
				<p class="text-muted">
					{m.band_slug_music_payouts_sales_go_straight_own_stripe_text()}
				</p>
				<Form remote={openPayoutDashboard} onsuccess={goToStripe}>
					{@const fields = openPayoutDashboard.fields}
					<input {...fields.slug.as('hidden', slug)} />
					<SubmitButton
						variant="ghost"
						label={m.band_slug_music_payouts_open_stripe_dashboard_label()}
					/>
				</Form>
			{:else}
				<p class="text-muted">
					{m.band_slug_music_payouts_sell_release_need_stripe_account_text()}
				</p>

				{#if payouts.requirementsDue.length > 0}
					<!-- Stripe's own list, verbatim. "Finish setting up" with no idea
					     what is missing is the reason people abandon this. -->
					<Alert type="warning">
						{m.band_slug_music_payouts_stripe_still_needs_body({
							join: payouts.requirementsDue.join(', ')
						})}
					</Alert>
				{/if}

				<Form remote={startPayoutOnboarding} onsuccess={goToStripe}>
					{@const fields = startPayoutOnboarding.fields}
					<input {...fields.slug.as('hidden', slug)} />
					<SubmitButton
						label={payouts.connected
							? m.band_slug_music_payouts_finish_setting_up_payouts_label()
							: m.band_set_up_payouts_label()}
					/>
				</Form>
			{/if}
		</CardBody>
	</Card>

	<Card>
		<CardBody>
			<CardTitle>{m.band_slug_music_payouts_what_collective_takes_title()}</CardTitle>
			<p class="text-muted">
				<ParaglideMessage
					message={m.band_slug_music_payouts_not_fixed_buyers_see_split_text}
					inputs={{
						suggested
					}}>{#snippet em({ children })}<em>{@render children?.()}</em>{/snippet}</ParaglideMessage
				>
			</p>
			<p class="text-muted">
				{m.band_slug_music_payouts_free_releases_skip_all_record_text()}
			</p>
		</CardBody>
	</Card>
</PageContent>
