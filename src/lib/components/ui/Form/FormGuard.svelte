<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { beforeNavigate, goto } from '$app/navigation';
	import { getFormContext } from './Form.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	let confirmModal: HTMLDialogElement | undefined = $state();
	let pendingNavigation: (() => void) | null = $state(null);
	let bypassing = $state(false);

	const form = getFormContext()!;

	beforeNavigate(({ cancel, to, willUnload, shallow }) => {
		// A shallow goto only rewrites the address bar, and the form stays mounted.
		if (shallow) return;
		if (bypassing) {
			bypassing = false;
			return;
		}
		if (form.status === 'dirty') {
			cancel();
			if (!willUnload && to?.url) {
				const url = to.url;
				pendingNavigation = () => {
					bypassing = true;
					form.reset();
					goto(url);
				};
				confirmModal?.showModal();
			}
		}
	});
</script>

<svelte:window
	onbeforeunload={(e) => {
		if (form.status === 'dirty') {
			e.preventDefault();
		}
	}}
/>

<dialog bind:this={confirmModal} class="modal">
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
					confirmModal?.close();
					pendingNavigation?.();
					pendingNavigation = null;
				}}
			>
				{m.ui_discard_changes_label()}
			</Button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button type="submit">{m.ui_close_label()}</button>
	</form>
</dialog>
