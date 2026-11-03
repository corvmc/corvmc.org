<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { IconPencil } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import PostFields from '$lib/components/classified/PostFields.svelte';
	import { editClassified, getClassifiedComposer } from '$lib/remote/classifieds.remote';
	import type { ClassifiedTagKind } from '$lib/config';

	/** Owns the composer query, so the detail page keeps one load-bearing query. */
	let {
		post,
		onsuccess
	}: {
		post: {
			id: string;
			kind: string;
			category: string;
			title: string;
			body: string;
			groupId: string | null;
			tags: { kind: ClassifiedTagKind; value: string }[];
		};
		onsuccess: () => void;
	} = $props();

	const composer = $derived(await getClassifiedComposer());
</script>

<Action
	action={editClassified}
	label={m.member_edit()}
	modalTitle={m.member_classifieds_id_edit_classified_modal_title()}
	submitLabel={m.member_save()}
	successToast={m.member_saved()}
	variant="ghost"
	size="sm"
	{onsuccess}
>
	{#snippet icon()}<IconPencil size={16} />{/snippet}
	{#snippet form()}
		<input {...editClassified.fields.postId.as('hidden', post.id)} />
		<PostFields
			fields={editClassified.fields}
			bands={composer.bands}
			instrumentSuggestions={composer.instrumentSuggestions}
			genreSuggestions={composer.genreSuggestions}
			initial={post}
		/>
	{/snippet}
</Action>
