<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { addSubscriber } from '$lib/remote/marketing.remote';

	const { fields } = addSubscriber;

	let {
		audienceId,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		audienceId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	let email = $state('');
	let name = $state('');
</script>

<Action
	action={addSubscriber}
	label="Add Subscriber"
	modalTitle="Add Subscriber"
	canSubmit={!!email.trim()}
	successToast="Subscriber added"
	{variant}
	{size}
	class={className}
	onsuccess={() => {
		email = '';
		name = '';
		(onsuccess ?? (() => invalidateAll()))();
	}}
	{...rest}
>
	{#snippet form()}
		<input {...fields.audienceId.as('hidden', audienceId)} />
		<!-- Named rather than field-bound: `canSubmit` and the post-success reset
		     both read these values, and the field spread has no two-way binding.
		     `FormField` resolves the issues by name through the form context. -->
		<FormField
			name="email"
			type="email"
			label="Email"
			bind:value={email}
			placeholder="email@example.com"
			required
		/>
		<FormField name="name" label="Name (optional)" bind:value={name} placeholder="Name" />
	{/snippet}
</Action>
