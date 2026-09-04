<script lang="ts">
	import {
		MembershipHero,
		BenefitsGrid,
		SlidingScale,
		CommunityImpact,
		MembershipFAQ,
		SubscriptionForm,
		ContributionCard,
		CreditBalanceCard,
		CancelledBanner
	} from '$lib/components/member/membership';
	import Button from '$lib/components/ui/Button.svelte';
	import { pageTitle } from '$lib/config';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { page } from '$app/state';
	import {
		createSubscription,
		updateAmount,
		resumeSubscription,
		getMemberMembership
	} from '$lib/remote/membership.remote';

	let data = $derived(await getMemberMembership());

	let subscribeModalOpen = $state(false);

	const subscription = $derived(data.subscription);
	const credits = $derived(data.credits);
	const billingPortalUrl = $derived(data.billingPortalUrl);
	const communityStats = $derived(data.communityStats);
	const allocatedThisMonth = $derived(data.allocatedThisMonth);
	const usedThisMonth = $derived(data.usedThisMonth);

	const isActive = $derived(subscription != null && !subscription.cancelAtPeriodEnd);
	const isCancelled = $derived(subscription != null && subscription.cancelAtPeriodEnd);
	const isNonMember = $derived(subscription == null);

	// `?subscribed` is the session's `return_url`. The subscription row is written
	// by the webhook, not by the payment, and contributions are now paid for on
	// our own page — so without this a member who just signed up lands on the
	// "become a sustaining member" pitch they have already accepted. Poll,
	// bounded: twenty seconds is longer than the webhook has taken, and the money
	// is taken either way.
	const justSubscribed = $derived(page.url.searchParams.has('subscribed'));
	const SUBSCRIBE_RETRY_LIMIT = 10;
	const SUBSCRIBE_RETRY_MS = 2000;
	let subscribeAttempts = $state(0);
	const awaitingSubscription = $derived(justSubscribed && isNonMember);

	$effect(() => {
		if (!awaitingSubscription || subscribeAttempts >= SUBSCRIBE_RETRY_LIMIT) return;

		const timer = setTimeout(() => {
			subscribeAttempts += 1;
			void getMemberMembership().refresh();
		}, SUBSCRIBE_RETRY_MS);

		return () => clearTimeout(timer);
	});
</script>

<!-- This page leads with MembershipHero instead of PageHeader, so it sets its
     own title rather than inheriting one. -->
<svelte:head>
	<title>{pageTitle('Membership')}</title>
</svelte:head>

{#snippet bottomCta(id?: string)}
	<div {id} class="rounded-xl bg-primary/5 p-8 text-center">
		<h2 class="mb-4 text-3xl font-bold">Sounds Good?</h2>
		<p class="mx-auto mb-6 max-w-2xl opacity-70">
			{communityStats.sustainingMemberCount} members are already in. Your contribution — whatever the
			amount — keeps the spaces open, the gear available, and the music going.
		</p>
		<Button variant="primary" size="lg" onclick={() => (subscribeModalOpen = true)}>
			Become a Sustaining Member
		</Button>
		<p class="mt-4 text-muted">Cancel anytime. Seriously.</p>
	</div>
{/snippet}

<Modal bind:open={subscribeModalOpen} title="Become a Sustaining Member">
	<SubscriptionForm mode="create" remote={createSubscription} />
</Modal>

<div class="space-y-8 pt-8">
	{#if awaitingSubscription}
		<Alert type="info">
			{subscribeAttempts >= SUBSCRIBE_RETRY_LIMIT
				? "We haven't had confirmation from our payment processor yet. Your card has been charged and your membership starts as soon as it lands — if this page still says otherwise in a few minutes, get in touch."
				: 'Confirming your payment…'}
		</Alert>
	{/if}
	<!-- Active sustaining member view -->
	{#if isActive && subscription}
		<MembershipHero variant="dashboard" />

		<ContributionCard {subscription} {billingPortalUrl} updateRemote={updateAmount} />

		<CreditBalanceCard {credits} {subscription} {allocatedThisMonth} {usedThisMonth} />

		<BenefitsGrid variant="compact" />

		<CommunityImpact stats={communityStats} />
	{/if}

	<!-- Cancelled-but-active view -->
	{#if isCancelled && subscription}
		<CancelledBanner {subscription} {billingPortalUrl} resumeAction={resumeSubscription} />

		<MembershipHero variant="cancelled" />

		<BenefitsGrid variant="full" />

		<SlidingScale />

		<CommunityImpact stats={communityStats} />

		<MembershipFAQ />

		{@render bottomCta()}
	{/if}

	<!-- Non-member view -->
	{#if isNonMember}
		<MembershipHero variant="marketing">
			{#snippet actions()}
				<Button variant="default" size="lg" onclick={() => (subscribeModalOpen = true)}>
					Become a Sustaining Member
				</Button>
			{/snippet}
		</MembershipHero>

		<BenefitsGrid variant="full" />

		<SlidingScale />

		<CommunityImpact stats={communityStats} />

		<MembershipFAQ />

		{@render bottomCta('subscribe')}
	{/if}
</div>
