<script lang="ts">
	import Action from '../Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { removeBandMember } from '$lib/remote/bands.remote';

	const { fields } = removeBandMember;

	let {
		memberId,
		name,
		variant = 'ghost',
		size = 'xs',
		class: className = 'text-error',
		onsuccess,
		...rest
	}: {
		memberId: string;
		name: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={removeBandMember}
	label="Remove"
	modalTitle="Confirm"
	successToast="Member removed"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.memberId.as('hidden', memberId)} />
		<p class="py-4">Remove {name} from this band?</p>
	{/snippet}
</Action>
