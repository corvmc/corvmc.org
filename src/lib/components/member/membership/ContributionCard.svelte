<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { formatDollars } from '$lib/utils/format';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { IconCreditCard } from '@tabler/icons-svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import { DOLLARS_PER_UNIT } from '$lib/config';
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import type { SubscriptionInfo } from '$lib/server/db/schema/finance';
	import SubscriptionForm from './SubscriptionForm.svelte';
	import type { RemoteForm } from '$lib/components/shared/Form/Form.svelte';

	let {
		subscription,
		billingPortalUrl,
		updateRemote,
		showModifyForm = false
	}: {
		subscription: SubscriptionInfo;
		billingPortalUrl: string | null;
		updateRemote: RemoteForm<any, any>;
		showModifyForm?: boolean;
	} = $props();

	let modalOpen = $state(untrack(() => showModifyForm));

	const amountPerMonth = $derived(subscription.quantity * DOLLARS_PER_UNIT);
	const feeAmount = $derived(
		formatDollars(calculateTotalWithFeeCoverage(amountPerMonth * 100).feeCents)
	);
	const nextBilling = $derived(
		subscription.currentPeriodEnd.toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		})
	);
</script>

<Card>
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconCreditCard size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">Your Contribution</h3>
				<p class="text-muted">Manage your monthly support</p>
			</div>
		</div>

		<div class="mt-4 flex items-center justify-between rounded-lg bg-base-200/50 p-4">
			<div>
				<div class="flex items-center gap-2">
					<span class="text-3xl font-bold">${amountPerMonth}/month</span>
					{#if subscription.coveringFees}
						<Badge variant="secondary">+ ${feeAmount} fees covered</Badge>
					{/if}
				</div>
				<p class="mt-1 text-muted">Next bill {nextBilling}</p>
			</div>
		</div>

		<div class="mt-4 flex flex-wrap gap-2">
			<Button variant="default" size="sm" outline onclick={() => (modalOpen = true)}
				>Modify Amount</Button
			>
			{#if billingPortalUrl}
				<Button href={billingPortalUrl} variant="default" size="sm" outline>Manage Billing</Button>
			{/if}
		</div>
	</CardBody>
</Card>

<Modal bind:open={modalOpen} title="Update Contribution">
	<SubscriptionForm
		mode="modify"
		currentAmount={amountPerMonth}
		currentCoverFees={subscription.coveringFees}
		remote={updateRemote}
		onsuccess={() => {
			modalOpen = false;
			toast.success('Contribution updated');
		}}
	/>
</Modal>
