<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { createAudience } from '$lib/remote/marketing.remote';
	import { Field } from '../ui/Form';

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
		{#snippet slugHint()}Used in the signup URL: /subscribe/{slug || '...'}{/snippet}
		<Field name="name" type="text" label="Name" bind:value={name} />
		<!-- Custom input to keep the monospace slug box; `Field`'s own input has a
		     fixed class. The wrapper supplies the label association and the error
		     slot the bare fieldset had no room for. -->
		<Field name="slug" label="Slug" description={slugHint}>
			{#snippet input(id)}
				<input
					{id}
					type="text"
					name="slug"
					bind:value={slug}
					placeholder="newsletter"
					class="input w-full font-mono text-sm"
					oninput={() => (slugManuallyEdited = true)}
				/>
			{/snippet}
		</Field>
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
