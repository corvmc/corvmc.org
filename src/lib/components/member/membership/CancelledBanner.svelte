<script lang="ts" generics="TInput extends RemoteFormInput, TOutput">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { formatMonthDayYear } from '#lib/utils/format.js';
	import type { RemoteForm, RemoteFormInput } from '$app/server';
	import { IconAlertTriangle } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import type { SubscriptionInfo } from '#lib/server/db/schema/finance.js';
	import Action from '#lib/components/ui/Action.svelte';

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
			<ParaglideMessage
				message={m.member_membership_cancelled_banner_sustaining_membership_has_text}
				inputs={{
					freeHours,
					endDate
				}}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}{#snippet strong2({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>

		<div class="mt-3 flex flex-wrap gap-2">
			<Action
				action={resumeAction}
				label={m.member_membership_cancelled_banner_label()}
				modalTitle={m.member_membership_cancelled_banner_title()}
				variant="primary"
				size="sm"
				onsuccess={() => toast.success(m.member_membership_cancelled_banner_toast())}
			>
				{#snippet form()}
					<p class="py-4">
						{m.member_membership_cancelled_banner_resume_sustaining_members_text()}
					</p>
				{/snippet}
			</Action>
		</div>
	</div>
</div>
