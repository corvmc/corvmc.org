<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { updateClosure } from '$lib/remote/closures.remote';

	let {
		closureId,
		reason,
		startsAt,
		endsAt,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		closureId: string;
		reason: string;
		startsAt: string;
		endsAt: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();

	const { fields } = updateClosure;
</script>

<Action
	action={updateClosure}
	label="Save"
	successToast="Closure updated"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', closureId)} />
		<input {...fields.reason.as('hidden', reason)} />
		<input {...fields.startsAt.as('hidden', startsAt)} />
		<input {...fields.endsAt.as('hidden', endsAt)} />
	{/snippet}
</Action>
