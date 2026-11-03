<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { bindTag } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';
	import BarcodeScanner from '../ui/BarcodeScanner.svelte';
	import { parseScan } from '$lib/utils/scan';

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

	// Starts empty even when rebinding: the point of a rebind is a *new* sticker,
	// and the current one is already stated above the field.
	let assetTag = $state('');

	/**
	 * A scanned sticker gives back the whole `/a/{tag}` URL, since that is what
	 * makes a phone camera resolve it with no app; `parseScan` unwraps it.
	 *
	 * Anything else lands in the field verbatim rather than being rejected — a
	 * roll of tags may be numbered in Code 128 rather than QR, and where it really
	 * is the wrong code the staffer can see that and correct it. Silently dropping
	 * a scan would just look broken.
	 */
	function handleScan(raw: string) {
		assetTag = parseScan(raw).value;
	}
</script>

<Action
	action={bindTag}
	data-testid="bind-tag"
	label={currentTag ? m.actions_bind_tag_rebind_tag() : m.actions_bind_tag_bind_tag()}
	modalTitle={currentTag ? m.actions_bind_tag_rebind_tag_2() : m.actions_bind_tag_bind_tag_2()}
	successToast={m.actions_bind_tag_success_toast()}
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
		<div class="mb-3 rounded bg-base-200 p-3 text-sm" data-testid="bind-tag-context">
			{#if currentTag}
				<p>This unit currently wears <strong class="font-mono">{currentTag}</strong>.</p>
				<p class="mt-1 opacity-70">
					{m.actions_bind_tag_binding_new_one_keeps_every()}
				</p>
			{:else}
				<p class="opacity-70">{m.actions_bind_tag_scan_type_tag_printed_sticker()}</p>
			{/if}
		</div>
		<Field field={fields.assetTag} type="text" label={m.actions_tag()} bind:value={assetTag} />
		<BarcodeScanner onscan={handleScan} label={m.actions_bind_tag_scan_tag()} class="mt-2" />
	{/snippet}
</Action>
