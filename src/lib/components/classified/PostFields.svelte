<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
		label={m.classified_post_fields_wanted_offered_trade()}
		description={m.classified_post_fields_description()}
		value={initial?.kind ?? 'wanted'}
		options={classifiedKindOptions}
	/>
	<FormField
		name="category"
		type="select"
		label={m.classified_category()}
		bind:value={category}
		options={classifiedCategoryOptions}
	/>
</div>
{#if category === 'gear'}
	<Alert type="warning">
		{m.classified_post_fields_replies_come_inbox_do_not({ CLASSIFIED_GEAR_DISCLAIMER })}
	</Alert>
{/if}
<FormField
	name="title"
	type="text"
	label={m.classified_post_fields_title()}
	value={initial?.title ?? ''}
/>
<FormField name="body" type="textarea" label={m.classified_details()} value={initial?.body ?? ''} />
{#if bands.length > 0}
	<FormField
		name="groupId"
		type="select"
		label={m.classified_post_fields_post_as()}
		value={initial?.groupId ?? ''}
		options={[{ value: '', label: m.classified_post_fields_just_me() }, ...bands]}
	/>
{/if}
<FormField name="instruments" label={m.classified_post_fields_instruments()}>
	<FreeformTagInput
		bind:value={instruments}
		suggestions={instrumentSuggestions}
		name="instruments"
		placeholder={m.classified_post_fields_e_g_drums_bass()}
	/>
</FormField>
<FormField name="genres" label={m.classified_post_fields_genres()}>
	<FreeformTagInput
		bind:value={genres}
		suggestions={genreSuggestions}
		name="genres"
		placeholder={m.classified_post_fields_e_g_surf_jazz()}
	/>
</FormField>
<FormField name="skills" label={m.classified_post_fields_skills()}>
	<FreeformTagInput
		bind:value={skills}
		name="skills"
		placeholder={m.classified_post_fields_e_g_mixing_lessons()}
	/>
</FormField>
