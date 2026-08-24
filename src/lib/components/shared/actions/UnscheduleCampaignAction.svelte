<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
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
	label="Cancel Schedule"
	modalTitle="Confirm"
	successToast="Campaign unscheduled — returned to draft"
	{variant}
	{size}
	class={className}
	{onsuccess}
	{...rest}
>
	{#snippet form()}
		<input {...fields.campaignId.as('hidden', campaignId)} />
		<p class="py-4">Cancel the scheduled send and return this campaign to draft?</p>
	{/snippet}
</Action>
