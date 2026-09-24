<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import PostFields from '$lib/components/classified/PostFields.svelte';
	import { createClassified, getClassifiedComposer } from '$lib/remote/classifieds.remote';

	const composer = $derived(await getClassifiedComposer());
</script>

<Action
	action={createClassified}
	label="New post"
	modalTitle="New post"
	submitLabel="Post it"
	successToast={composer.requiresReview ? 'Sent to staff for review' : 'Posted to the board'}
	variant="primary"
	size="sm"
	onsuccess={(r) => {
		if (r && typeof r === 'object' && 'id' in r) {
			void goto(resolve(`/member/classifieds/${r.id as string}`));
		}
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		{#if composer.requiresReview}
			<p class="mb-3 text-muted">Staff will look at this before it goes on the board.</p>
		{/if}
		<PostFields
			bands={composer.bands}
			instrumentSuggestions={composer.instrumentSuggestions}
			genreSuggestions={composer.genreSuggestions}
		/>
	{/snippet}
</Action>
