<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import {
		MembershipHero,
		BenefitsGrid,
		SlidingScale,
		CommunityImpact,
		MembershipFAQ,
		SubscriptionForm,
		ContributionCard,
		CreditBalanceCard,
		CancelledBanner,
		PaymentMethodsCard,
		InvoiceHistoryCard
	} from '#lib/components/member/membership/index.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { pageTitle } from '#lib/config.js';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { page } from '$app/state';
	import {
		createSubscription,
		updateAmount,
		resumeSubscription,
		cancelSubscription,
		getMemberMembership
	} from '#lib/remote/membership.remote.js';
	import { getBilling } from '#lib/remote/billing.remote.js';

	let data = $derived(await getMemberMembership());

	let subscribeModalOpen = $state(false);

	const subscription = $derived(data.subscription);
	const credits = $derived(data.credits);
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
		<h2 class="mb-4 text-3xl font-bold">{m.member_membership_sounds_good_title()}</h2>
		<p class="mx-auto mb-6 max-w-2xl opacity-70">
			{m.member_membership_members_already_contribution_whatever_amou_text({
				sustainingMemberCount: communityStats.sustainingMemberCount
			})}
		</p>
		<Button variant="primary" size="lg" onclick={() => (subscribeModalOpen = true)}>
			{m.member_membership_become_sustaining_member_label()}
		</Button>
		<p class="mt-4 text-muted">{m.member_membership_cancel_anytime_seriously_text()}</p>
	</div>
{/snippet}

{#snippet billing()}
	<!--
		The only live Stripe calls left on this page, so they get their own
		boundary: the billing-portal link they replace sat inside
		`getMemberMembership`'s `Promise.all`, where an outage took the whole page
		down. `pending` is an attribute, not a snippet — a `pending` snippet makes
		the boundary skip its contents server-side.
	-->
	<svelte:boundary pending={null}>
		{@const billingData = await getBilling()}
		<PaymentMethodsCard
			cards={billingData.cards}
			available={billingData.available}
			driver={billingData.driver}
		/>
		<InvoiceHistoryCard invoices={billingData.invoices} available={billingData.available} />

		{#snippet failed()}
			<Alert type="warning">
				{m.member_membership_we_couldn_t_load_billing_body()}
			</Alert>
		{/snippet}
	</svelte:boundary>
{/snippet}

<Modal bind:open={subscribeModalOpen} title={m.member_membership_become_sustaining_member_title()}>
	<SubscriptionForm mode="create" remote={createSubscription} />
</Modal>

<div class="space-y-8 pt-8">
	{#if awaitingSubscription}
		<Alert type="info">
			{subscribeAttempts >= SUBSCRIBE_RETRY_LIMIT
				? m.member_membership_we_haven_t_had_confirmation_body()
				: m.member_confirming_payment_body()}
		</Alert>
	{/if}
	<!-- Active sustaining member view -->
	{#if isActive && subscription}
		<MembershipHero variant="dashboard" />

		<ContributionCard
			{subscription}
			updateRemote={updateAmount}
			cancelAction={cancelSubscription}
		/>

		{@render billing()}

		<CreditBalanceCard {credits} {subscription} {allocatedThisMonth} {usedThisMonth} />

		<BenefitsGrid variant="compact" />

		<CommunityImpact stats={communityStats} />
	{/if}

	<!-- Cancelled-but-active view -->
	{#if isCancelled && subscription}
		<CancelledBanner {subscription} resumeAction={resumeSubscription} />

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
					{m.member_membership_become_sustaining_member_label()}
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
