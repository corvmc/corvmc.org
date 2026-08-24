<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
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
		<div>
			<label for="sub-email" class="text-subtle">Email</label>
			<input
				id="sub-email"
				type="email"
				name="email"
				bind:value={email}
				placeholder="email@example.com"
				class="input w-full"
				required
			/>
		</div>
		<div>
			<label for="sub-name" class="text-subtle">Name (optional)</label>
			<input
				id="sub-name"
				type="text"
				name="name"
				bind:value={name}
				placeholder="Name"
				class="input w-full"
			/>
		</div>
	{/snippet}
</Action>
