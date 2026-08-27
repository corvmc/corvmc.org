<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { suggestionCategories, suggestionCategoryLabels } from '$lib/config';
	import { createSuggestion, getMySuggestionStanding } from '$lib/remote/suggestions.remote';

	/**
	 * "Suggest something", owning the standing query that decides its wording.
	 *
	 * A member under review posts to staff rather than straight to the board, and both the success
	 * toast and the note inside the form say so. Reading that on the page meant a second remote
	 * query in flight there — see StandingNotice for why composing it into the board query is the
	 * wrong trade.
	 */
	const standing = $derived(await getMySuggestionStanding());
</script>

<Action
	action={createSuggestion}
	label="Suggest something"
	modalTitle="Suggest something"
	submitLabel="Post it"
	successToast={standing.status !== 'none' ? 'Sent to staff for review' : 'Posted to the board'}
	variant="primary"
	size="sm"
	onsuccess={(r) => {
		if (r && typeof r === 'object' && 'id' in r) {
			void goto(resolve(`/member/suggestions/${r.id as string}`));
		}
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		{#if standing.status !== 'none'}
			<p class="mb-3 text-muted">Staff will look at this before it goes on the board.</p>
		{/if}
		<FormField name="title" type="text" label="What should we do?" />
		<FormField name="body" type="textarea" label="Tell us a bit more" />
		<FormField
			name="category"
			type="select"
			label="Category"
			options={suggestionCategories.map((c) => ({
				value: c,
				label: suggestionCategoryLabels[c]
			}))}
		/>
	{/snippet}
</Action>
