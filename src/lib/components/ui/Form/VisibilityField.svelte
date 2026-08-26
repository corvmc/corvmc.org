<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import FormField from './FormField.svelte';

	let {
		field,
		value = $bindable('members'),
		publicDescription = 'Anyone can see your profile, no login required',
		name = 'directoryVisibility'
	}: {
		field?: RemoteFormField<any>;
		value?: string;
		publicDescription?: string;
		name?: string;
	} = $props();

	const options = $derived([
		{ value: 'hidden', label: 'Hidden', description: 'Not shown in any directory' },
		{ value: 'members', label: 'Members only', description: 'Visible to logged-in members' },
		{ value: 'public', label: 'Public', description: publicDescription }
	]);
</script>

<FormField {field} label="Directory visibility">
	<div class="space-y-2">
		{#each options as option (option.value)}
			<label class="label cursor-pointer justify-start gap-3">
				<input
					type="radio"
					{name}
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
