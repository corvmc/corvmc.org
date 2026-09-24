<script lang="ts">
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import FreeformTagInput from '$lib/components/ui/FreeformTagInput.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import {
		classifiedKindOptions,
		classifiedCategoryOptions,
		CLASSIFIED_GEAR_DISCLAIMER,
		type ClassifiedTagKind
	} from '$lib/config';

	/** The fields of a classified post, shared by the create and edit modals. */
	let {
		bands,
		instrumentSuggestions,
		genreSuggestions,
		initial
	}: {
		bands: { value: string; label: string }[];
		instrumentSuggestions: string[];
		genreSuggestions: string[];
		initial?: {
			kind: string;
			category: string;
			title: string;
			body: string;
			groupId: string | null;
			tags: { kind: ClassifiedTagKind; value: string }[];
		};
	} = $props();

	function tagsOf(kind: ClassifiedTagKind) {
		return (initial?.tags ?? []).filter((t) => t.kind === kind).map((t) => t.value);
	}

	let instruments = $state(tagsOf('instrument'));
	let genres = $state(tagsOf('genre'));
	let skills = $state(tagsOf('skill'));
	let category = $state(initial?.category ?? 'musician');
</script>

<div class="grid gap-3 sm:grid-cols-2">
	<FormField
		name="kind"
		type="select"
		label="Wanted, offered or trade"
		description="Trade is for gear only. An offered gear post shows as for sale."
		value={initial?.kind ?? 'wanted'}
		options={classifiedKindOptions}
	/>
	<FormField
		name="category"
		type="select"
		label="Category"
		bind:value={category}
		options={classifiedCategoryOptions}
	/>
</div>
{#if category === 'gear'}
	<Alert type="warning">
		{CLASSIFIED_GEAR_DISCLAIMER} Replies come to your inbox; do not post payment details.
	</Alert>
{/if}
<FormField name="title" type="text" label="Title" value={initial?.title ?? ''} />
<FormField name="body" type="textarea" label="Details" value={initial?.body ?? ''} />
{#if bands.length > 0}
	<FormField
		name="groupId"
		type="select"
		label="Post as"
		value={initial?.groupId ?? ''}
		options={[{ value: '', label: 'Just me' }, ...bands]}
	/>
{/if}
<FormField name="instruments" label="Instruments">
	<FreeformTagInput
		bind:value={instruments}
		suggestions={instrumentSuggestions}
		name="instruments"
		placeholder="e.g. drums, bass..."
	/>
</FormField>
<FormField name="genres" label="Genres">
	<FreeformTagInput
		bind:value={genres}
		suggestions={genreSuggestions}
		name="genres"
		placeholder="e.g. surf, jazz..."
	/>
</FormField>
<FormField name="skills" label="Skills">
	<FreeformTagInput bind:value={skills} name="skills" placeholder="e.g. mixing, lessons..." />
</FormField>
