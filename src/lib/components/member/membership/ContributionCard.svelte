<script lang="ts" generics="TInput extends RemoteFormInput, TOutput">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { formatDollars } from '$lib/utils/format';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { IconCreditCard } from '@tabler/icons-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { DOLLARS_PER_UNIT } from '$lib/config';
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import type { SubscriptionInfo } from '$lib/server/db/schema/finance';
	import SubscriptionForm from './SubscriptionForm.svelte';
	import type { RemoteForm } from '$lib/components/ui/Form/Form.svelte';
	import type { RemoteFormInput } from '@sveltejs/kit';
	import type { ComponentProps } from 'svelte';

	let {
		subscription,
		updateRemote,
		cancelAction,
		showModifyForm = false
	}: {
		subscription: SubscriptionInfo;
		updateRemote: RemoteForm<TInput, TOutput>;
		/**
		 * Cancelling used to be reachable only through Stripe's billing portal,
		 * which is why this is the one control here that is new rather than moved.
		 *
		 * Typed off `Action`'s own prop rather than as a second `RemoteForm<…>`:
		 * `RemoteForm` is invariant in its input, so a second one in this props
		 * object drags `TInput` down to `RemoteFormInput` and `updateRemote` stops
		 * accepting the concrete form the page passes.
		 */
		cancelAction: ComponentProps<typeof Action>['action'];
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
			<Action
				action={cancelAction}
				label="Cancel Membership"
				modalTitle="Cancel Membership"
				variant="error"
				size="sm"
				outline
				onsuccess={() => toast.success('Membership cancelled')}
			>
				{#snippet form()}
					<p class="py-4">
						Your benefits — including <strong>{subscription.quantity} free practice hours</strong> —
						stay active until <strong>{nextBilling}</strong>, and you can pick it back up any time
						before then.
					</p>
				{/snippet}
			</Action>
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
