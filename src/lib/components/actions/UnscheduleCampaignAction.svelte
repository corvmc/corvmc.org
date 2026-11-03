<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { unscheduleCampaign } from '$lib/remote/marketing.remote';

	const { fields } = unscheduleCampaign;

	let {
		campaignId,
		variant = 'warning',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		campaignId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={unscheduleCampaign}
	label={m.actions_unschedule_campaign_label()}
	modalTitle={m.actions_confirm()}
	successToast={m.actions_unschedule_campaign_success_toast()}
	{variant}
	{size}
	class={className}
	{onsuccess}
	{...rest}
>
	{#snippet form()}
		<input {...fields.campaignId.as('hidden', campaignId)} />
		<p class="py-4">{m.actions_unschedule_campaign_cancel_scheduled_send_return_cam()}</p>
	{/snippet}
</Action>
