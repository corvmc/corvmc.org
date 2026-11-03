<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	label={m.actions_create_audience_new_audience()}
	modalTitle={m.actions_create_audience_new_audience()}
	submitLabel={m.actions_create_audience_submit_label()}
	canSubmit={!!name.trim()}
	successToast={m.actions_create_audience_success_toast()}
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
		{#snippet slugHint()}{m.actions_create_audience_used_signup_url_subscribe({
				value: slug || '...'
			})}{/snippet}
		<Field name="name" type="text" label={m.actions_name()} bind:value={name} />
		<!-- Custom input to keep the monospace slug box; `Field`'s own input has a
		     fixed class. The wrapper supplies the label association and the error
		     slot the bare fieldset had no room for. -->
		<Field name="slug" label={m.actions_create_audience_slug()} description={slugHint}>
			{#snippet input(id)}
				<input
					{id}
					type="text"
					name="slug"
					bind:value={slug}
					placeholder={m.actions_create_audience_placeholder()}
					class="input w-full font-mono text-sm"
					oninput={() => (slugManuallyEdited = true)}
				/>
			{/snippet}
		</Field>
		<Field
			name="description"
			type="textarea"
			label={m.actions_description()}
			bind:value={description}
		/>
		<Field
			name="allowOptIn"
			type="checkbox"
			value={allowOptIn}
			checkboxLabel={m.actions_create_audience_checkbox_label()}
			description={m.actions_create_audience_description()}
		/>
	{/snippet}
</Action>
