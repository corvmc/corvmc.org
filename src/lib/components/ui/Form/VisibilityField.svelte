<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteFormFieldValue, RemoteFormField } from '$app/server';
	import FormField from './FormField.svelte';

	let {
		field,
		value = $bindable('members'),
		publicDescription = m.ui_visibility_public_hint(),
		name = 'directoryVisibility'
	}: {
		field?: RemoteFormField<RemoteFormFieldValue>;
		value?: string;
		publicDescription?: string;
		name?: string;
	} = $props();

	const options = $derived([
		{
			value: 'hidden',
			label: m.ui_visibility_hidden(),
			description: m.ui_visibility_hidden_hint()
		},
		{
			value: 'members',
			label: m.ui_visibility_members(),
			description: m.ui_visibility_members_hint()
		},
		{ value: 'public', label: m.ui_visibility_public(), description: publicDescription }
	]);
</script>

<FormField {field} label={m.ui_visibility_label()}>
	<div class="space-y-2">
		{#each options as option (option.value)}
			<label class="label cursor-pointer justify-start gap-3">
				<input
					type="radio"
					name={field ? field.as('radio', option.value).name : name}
					value={option.value}
					class="radio"
					checked={value === option.value}
					onchange={() => (value = option.value)}
				/>
				<div>
					<p>{option.label}</p>
					<p class="text-xs opacity-50">{option.description}</p>
				</div>
			</label>
		{/each}
	</div>
</FormField>
