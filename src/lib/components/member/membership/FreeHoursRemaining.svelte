<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { errorMessage } from '#lib/error-message.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { formatDate } from '#lib/utils/format.js';
	import { creditsToHours } from '#lib/config.js';
	import { getMembershipStatus } from '#lib/remote/reservations.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { IconClock } from '@tabler/icons-svelte';
</script>

<div
	class="flex flex-col gap-1 rounded-lg border border-base-300 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
>
	{#await getMembershipStatus()}
		<div class="flex items-center gap-2">
			<IconClock size={18} class="text-gray-400" />
			<span class="text-gray-400"
				>{m.member_membership_free_hours_remaining_loading_free_hours_text()}</span
			>
		</div>
	{:then membership}
		{#if membership.isSustainingMember}
			{@const hasHours = membership.freeHoursBalance > 0}
			{@const hoursRemaining = creditsToHours(membership.freeHoursBalance)}
			<div class="flex items-center gap-2">
				<IconClock size={18} class={hasHours ? 'text-success' : 'opacity-40'} />
				<ParaglideMessage
					message={m.member_membership_free_hours_remaining_free_hours_remaining_text}
					inputs={{ hoursRemaining }}
					>{#snippet span({ children })}<span
							class={hasHours ? 'font-medium' : 'font-medium opacity-40'}
							>{@render children?.()}</span
						>{/snippet}{#snippet span2({ children })}<span
							class="text-sm {hasHours ? 'opacity-60' : 'opacity-30'}">{@render children?.()}</span
						>{/snippet}</ParaglideMessage
				>
			</div>
			{#if membership.creditsResetAt}
				<span class="text-sm {hasHours ? 'opacity-60' : 'opacity-30'}">
					{m.member_membership_free_hours_remaining_resets_text({
						creditsToHours: creditsToHours(membership.hoursPerReset),
						formatDate: formatDate(new Date(membership.creditsResetAt))
					})}
				</span>
			{/if}
		{:else}
			<div class="flex items-center gap-3">
				<IconClock size={18} class="shrink-0 opacity-40" />
				<span>{m.member_membership_free_hours_remaining_get_free_practice_hou_text()}</span>
			</div>
			<Button href="/member/membership" variant="default" size="sm" class="self-end sm:self-auto"
				>{m.member_membership_free_hours_remaining_learn_more_label()}</Button
			>
		{/if}
	{:catch error}
		<span class="text-subtle">{m.ui_load_failed_text({ error: errorMessage(error) })}</span>
	{/await}
</div>
