<script lang="ts" module>
	// Shared by every guard on the page: one dialog per navigation, and one
	// "Discard" lets that navigation past all of them.
	let claimed: object | null = null;
	let bypassHref: string | null = null;
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { beforeNavigate, goto } from '$app/navigation';
	import { getFormContext } from './Form.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	let {
		dirty
	}: {
		/** For an editor not built on `<Form>`. Defaults to the enclosing form's state. */
		dirty?: () => boolean;
	} = $props();

	let confirmModal: HTMLDialogElement | undefined = $state();
	let pendingNavigation: (() => void) | null = $state(null);

	const form = getFormContext();
	const isDirty = () => (dirty ? dirty() : form?.status === 'dirty');

	beforeNavigate((navigation) => {
		const { cancel, to, willUnload, shallow } = navigation;
		// A shallow goto only rewrites the address bar, and the form stays mounted.
		if (shallow) return;
		if (to?.url && to.url.href === bypassHref) return;
		bypassHref = null;
		if (!isDirty()) return;
		cancel();
		if (willUnload || !to?.url || claimed === navigation) return;
		claimed = navigation;
		const url = to.url;
		pendingNavigation = () => {
			bypassHref = url.href;
			form?.reset();
			goto(url);
		};
	});
</script>

<svelte:window
	onbeforeunload={(e) => {
		if (isDirty()) {
			e.preventDefault();
		}
	}}
/>

<!-- Rendered only while asking, so a page carries no hidden second dialog. -->
{#if pendingNavigation}
	<dialog
		bind:this={confirmModal}
		class="modal"
		{@attach (el) => el.showModal()}
		onclose={() => (pendingNavigation = null)}
	>
		<div class="modal-box">
			<h3 class="text-lg font-bold">{m.ui_unsaved_title()}</h3>
			<p class="py-4">{m.ui_unsaved_leave_prompt_text()}</p>
			<div class="modal-action">
				<Button type="button" variant="default" onclick={() => confirmModal?.close()}
					>{m.ui_keep_editing_label()}</Button
				>
				<Button
					type="button"
					variant="error"
					onclick={() => {
						pendingNavigation?.();
						confirmModal?.close();
					}}
				>
					{m.ui_discard_changes_label()}
				</Button>
			</div>
		</div>
		<div class="modal-backdrop">
			<button type="button" onclick={() => confirmModal?.close()}>{m.ui_close_label()}</button>
		</div>
	</dialog>
{/if}
