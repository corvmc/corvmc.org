<script lang="ts" generics="TInput extends RemoteFormInput, TOutput">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import { formatDollars, formatMonthDayYear } from '#lib/utils/format.js';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { IconCreditCard } from '@tabler/icons-svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { DOLLARS_PER_UNIT } from '#lib/config.js';
	import { calculateTotalWithFeeCoverage } from '#lib/finance/fees.js';
	import type { SubscriptionInfo } from '#lib/server/db/schema/finance.js';
	import SubscriptionForm from './SubscriptionForm.svelte';
	import type { RemoteForm } from '#lib/components/ui/Form/Form.svelte';
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
		 * Cancelling was reachable only through Stripe's billing portal, so this is
		 * the one control here that is new rather than moved.
		 *
		 * Typed off `Action`'s own prop, not as a second `RemoteForm<…>`: that type
		 * is invariant in its input, so a second one here drags `TInput` down to
		 * `RemoteFormInput` and `updateRemote` stops accepting the page's form.
		 */
		cancelAction: ComponentProps<typeof Action>['action'];
		showModifyForm?: boolean;
	} = $props();

	let modalOpen = $state(untrack(() => showModifyForm));

	const amountPerMonth = $derived(subscription.quantity * DOLLARS_PER_UNIT);
	const feeAmount = $derived(
		formatDollars(calculateTotalWithFeeCoverage(amountPerMonth * 100).feeCents)
	);
	const nextBilling = $derived(formatMonthDayYear(subscription.currentPeriodEnd));
</script>

<Card testid="contribution">
	<CardBody>
		<div class="flex items-center gap-4">
			<div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<IconCreditCard size={24} class="text-primary" />
			</div>
			<div>
				<h3 class="text-xl font-semibold">
					{m.member_membership_contribution_card_contribution()}
				</h3>
				<p class="text-muted">{m.member_membership_contribution_card_manage_monthly_support()}</p>
			</div>
		</div>

		<div class="mt-4 flex items-center justify-between rounded-lg bg-base-200/50 p-4">
			<div>
				<div class="flex items-center gap-2">
					<span class="text-3xl font-bold"
						>{m.member_membership_contribution_card_month({ amountPerMonth })}</span
					>
					{#if subscription.coveringFees}
						<Badge variant="secondary"
							>{m.member_membership_contribution_card_fees_covered({ feeAmount })}</Badge
						>
					{/if}
				</div>
				<p class="mt-1 text-muted">
					{m.member_membership_contribution_card_next_bill({ nextBilling })}
				</p>
			</div>
		</div>

		<div class="mt-4 flex flex-wrap gap-2">
			<Button variant="default" size="sm" outline onclick={() => (modalOpen = true)}
				>{m.member_membership_contribution_card_modify_amount()}</Button
			>
			<Action
				action={cancelAction}
				label={m.member_membership_contribution_card_label()}
				modalTitle={m.member_membership_contribution_card_label()}
				variant="error"
				size="sm"
				outline
				onsuccess={() =>
					toast.success(m.member_membership_contribution_card_membership_cancelled())}
			>
				{#snippet form()}
					<p class="py-4">
						<ParaglideMessage
							message={m.member_membership_contribution_card_benefits_including_stay}
							inputs={{
								quantity: subscription.quantity,
								nextBilling
							}}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}{#snippet strong2({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				{/snippet}
			</Action>
		</div>
	</CardBody>
</Card>

<Modal bind:open={modalOpen} title={m.member_update_contribution()}>
	<SubscriptionForm
		mode="modify"
		currentAmount={amountPerMonth}
		currentCoverFees={subscription.coveringFees}
		remote={updateRemote}
		onsuccess={() => {
			modalOpen = false;
			toast.success(m.member_membership_contribution_card_contribution_updated());
		}}
	/>
</Modal>
