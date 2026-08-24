<script lang="ts">
	import type { RemoteForm } from '@sveltejs/kit';
	import { IconAlertTriangle } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import type { SubscriptionInfo } from '$lib/server/db/schema/finance';
	import Action from '$lib/components/shared/Action.svelte';
	import Button from '$lib/components/shared/Button.svelte';

	let {
		subscription,
		billingPortalUrl,
		resumeAction
	}: {
		subscription: SubscriptionInfo;
		billingPortalUrl: string | null;
		resumeAction: RemoteForm<any, any>;
	} = $props();

	const endDate = $derived(
		subscription.currentPeriodEnd.toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		})
	);
	const freeHours = $derived(subscription.quantity);
</script>

<div class="alert alert-warning">
	<IconAlertTriangle size={24} class="shrink-0" />

	<div>
		<p>
			Your sustaining membership has been cancelled, but your benefits — including <strong
				>{freeHours} free practice hours</strong
			>
			— are still active until <strong>{endDate}</strong>. You can pick it back up anytime before
			then.
		</p>

		<div class="mt-3 flex flex-wrap gap-2">
			<Action
				action={resumeAction}
				label="Resume Membership"
				modalTitle="Resume Membership"
				variant="primary"
				size="sm"
				onsuccess={() => toast.success('Membership resumed')}
			>
				{#snippet form()}
					<p class="py-4">Resume your sustaining membership?</p>
				{/snippet}
			</Action>

			{#if billingPortalUrl}
				<Button href={billingPortalUrl} variant="default" size="sm" outline>Manage Billing</Button>
			{/if}
		</div>
	</div>
</div>
