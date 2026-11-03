<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
	label={m.actions_add_subscriber_add_subscriber()}
	modalTitle={m.actions_add_subscriber_add_subscriber()}
	canSubmit={!!email.trim()}
	successToast={m.actions_add_subscriber_success_toast()}
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
			field={addSubscriber.fields.email}
			type="email"
			label={m.actions_email()}
			bind:value={email}
			placeholder={m.actions_add_subscriber_email_example_com()}
			required
		/>
		<FormField
			field={addSubscriber.fields.name}
			label={m.actions_name_optional()}
			bind:value={name}
			placeholder={m.actions_name()}
		/>
	{/snippet}
</Action>
