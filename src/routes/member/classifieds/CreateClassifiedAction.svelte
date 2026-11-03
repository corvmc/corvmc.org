<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import PostFields from '#lib/components/classified/PostFields.svelte';
	import { createClassified, getClassifiedComposer } from '#lib/remote/classifieds.remote.js';

	const composer = $derived(await getClassifiedComposer());
</script>

<Action
	action={createClassified}
	label={m.member_classifieds_create_classified_label()}
	modalTitle={m.member_classifieds_create_classified_label()}
	submitLabel={m.member_post()}
	successToast={composer.requiresReview ? m.member_sent_staff_review() : m.member_posted_board()}
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
			<p class="mb-3 text-muted">{m.member_staff_will_look_at_before()}</p>
		{/if}
		<PostFields
			bands={composer.bands}
			instrumentSuggestions={composer.instrumentSuggestions}
			genreSuggestions={composer.genreSuggestions}
		/>
	{/snippet}
</Action>
