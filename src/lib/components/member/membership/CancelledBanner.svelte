<script lang="ts" generics="TInput extends RemoteFormInput, TOutput">
	import { m } from '$lib/paraglide/messages.js';
	import { formatMonthDayYear } from '$lib/utils/format';
	import type { RemoteForm, RemoteFormInput } from '@sveltejs/kit';
	import { IconAlertTriangle } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import type { SubscriptionInfo } from '$lib/server/db/schema/finance';
	import Action from '$lib/components/ui/Action.svelte';

	let {
		subscription,
		resumeAction
	}: {
		subscription: SubscriptionInfo;
		resumeAction: RemoteForm<TInput, TOutput>;
	} = $props();

	const endDate = $derived(formatMonthDayYear(subscription.currentPeriodEnd));
	const freeHours = $derived(subscription.quantity);
</script>

<div class="alert alert-warning">
	<IconAlertTriangle size={24} class="shrink-0" />

	<div>
		<p>
			Your sustaining membership has been cancelled, but your benefits — including <strong
				>{m.member_membership_cancelled_banner_free_practice_hours({ freeHours })}</strong
			>
			— are still active until <strong>{endDate}</strong>. You can pick it back up anytime before
			then.
		</p>

		<div class="mt-3 flex flex-wrap gap-2">
			<Action
				action={resumeAction}
				label={m.member_membership_cancelled_banner_label()}
				modalTitle={m.member_membership_cancelled_banner_label()}
				variant="primary"
				size="sm"
				onsuccess={() => toast.success(m.member_membership_cancelled_banner_toast())}
			>
				{#snippet form()}
					<p class="py-4">{m.member_membership_cancelled_banner_resume_sustaining_members()}</p>
				{/snippet}
			</Action>
		</div>
	</div>
</div>
