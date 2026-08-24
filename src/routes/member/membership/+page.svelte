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
	import Button from '$lib/components/shared/Button.svelte';
	import { pageTitle } from '$lib/config';
	import Modal from '$lib/components/shared/Modal.svelte';
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
