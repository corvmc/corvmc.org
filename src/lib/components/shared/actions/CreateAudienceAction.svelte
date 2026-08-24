<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { createAudience } from '$lib/remote/marketing.remote';
	import { Field } from '../Form';

	let {
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: (result: unknown) => void;
		[key: string]: unknown;
	} = $props();

	let name = $state('');
	let slug = $state('');
	let description = $state('');
	let allowOptIn = $state(false);
	let slugManuallyEdited = $state(false);

	$effect(() => {
		if (!slugManuallyEdited && name) {
			// Mirrors `generateSlug` on the server: spaces and punctuation are
			// dropped, not hyphenated.
			slug = name
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, '')
				.replace(/-{2,}/g, '-')
				.replace(/^-|-$/g, '');
		}
	});
</script>

<Action
	action={createAudience}
	label="New Audience"
	modalTitle="New Audience"
	submitLabel="Create Audience"
	canSubmit={!!name.trim()}
	successToast="Audience created"
	{variant}
	{size}
	class={className}
	maxWidth="max-w-md"
	onsuccess={(result) => {
		name = '';
		slug = '';
		description = '';
		allowOptIn = false;
		slugManuallyEdited = false;
		onsuccess?.(result);
	}}
	{...rest}
>
	{#snippet form()}
		<Field name="name" type="text" label="Name" bind:value={name} />
		<fieldset class="fieldset">
			<legend class="fieldset-legend">Slug</legend>
			<input
				type="text"
				name="slug"
				bind:value={slug}
				placeholder="newsletter"
				class="input w-full font-mono text-sm"
				oninput={() => (slugManuallyEdited = true)}
			/>
			<p class="text-subtle mt-1">Used in the signup URL: /subscribe/{slug || '...'}</p>
		</fieldset>
		<Field name="description" type="textarea" label="Description" bind:value={description} />
		<Field
			name="allowOptIn"
			type="checkbox"
			value={allowOptIn}
			checkboxLabel="Allow public opt-in"
			description="Show on public subscribe page and member account"
		/>
	{/snippet}
</Action>
