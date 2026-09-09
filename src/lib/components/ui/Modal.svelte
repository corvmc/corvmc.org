<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		maxWidth = 'max-w-lg',
		titleSnippet,
		children,
		onclose,
		confirmClose
	}: {
		open?: boolean;
		title?: string;
		maxWidth?: string;
		titleSnippet?: Snippet;
		children: Snippet;
		onclose?: () => void;
		/**
		 * Vetoes a close. Return false to keep the dialog open — the caller is
		 * expected to be asking the user something. Every close goes through here:
		 * the ✕, Escape and a click on the backdrop.
		 */
		confirmClose?: () => boolean;
	} = $props();

	function handleOpenChange(next: boolean) {
		if (!next && confirmClose && !confirmClose()) {
			open = true;
			return;
		}
		open = next;
		if (!next) onclose?.();
	}

	let contentEl = $state<HTMLElement | null>(null);

	// bits-ui focuses the first tabbable element on open, which here is the close
	// button: a screen-reader user opening any action dialog heard "✕, button"
	// before the dialog's own name. Focusing the dialog element announces the
	// title first, and Tab still lands on the close button next.
	function focusDialog(event: Event) {
		event.preventDefault();
		contentEl?.focus();
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class="modal modal-open bg-black/40" />
		<Dialog.Content
			bind:ref={contentEl}
			class="modal modal-open"
			tabindex={-1}
			onOpenAutoFocus={focusDialog}
		>
			<div class="modal-box {maxWidth}">
				<div class="mb-4 flex items-center justify-between">
					{#if titleSnippet}
						{@render titleSnippet()}
					{:else if title}
						<Dialog.Title class="text-lg font-bold">{title}</Dialog.Title>
					{/if}
					<!-- The glyph is decoration; "Close" is the name the button is announced by. -->
					<Dialog.Close class="btn btn-circle btn-outline btn-sm" aria-label="Close">
						<span aria-hidden="true">✕</span>
					</Dialog.Close>
				</div>

				{@render children()}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
