<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { bindTag } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';

	const { fields } = bindTag;

	let {
		assetId,
		currentTag,
		variant = 'ghost',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		assetId: string;
		currentTag?: string | null;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={bindTag}
	label={currentTag ? 'Rebind tag' : 'Bind tag'}
	modalTitle={currentTag ? 'Rebind the tag' : 'Bind a tag'}
	successToast="Tag bound"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.assetId.as('hidden', assetId)} />
		<!-- Stickers come off amps. Rebinding is ordinary: the unit keeps its id,
		     its history and its loans, because identity is the record and not the
		     label stuck to it. -->
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			{#if currentTag}
				<p>This unit currently wears <strong class="font-mono">{currentTag}</strong>.</p>
				<p class="mt-1 opacity-70">
					Binding a new one keeps every loan and repair already recorded against it.
				</p>
			{:else}
				<p class="opacity-70">Scan or type the tag printed on the sticker.</p>
			{/if}
		</div>
		<Field field={fields.assetTag} type="text" label="Tag" />
	{/snippet}
</Action>
