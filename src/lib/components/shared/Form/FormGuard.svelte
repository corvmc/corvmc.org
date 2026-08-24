<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { getFormContext } from './Form.svelte';
	import Button from '$lib/components/shared/Button.svelte';

	let confirmModal: HTMLDialogElement | undefined = $state();
	let pendingNavigation: (() => void) | null = $state(null);
	let bypassing = $state(false);

	const form = getFormContext()!;

	beforeNavigate(({ cancel, to, willUnload }) => {
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
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- `url` is the already-resolved navigation target supplied by SvelteKit's beforeNavigate
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
		<h3 class="text-lg font-bold">Unsaved changes</h3>
		<p class="py-4">You have unsaved changes. Are you sure you want to leave?</p>
		<div class="modal-action">
			<Button type="button" variant="default" onclick={() => confirmModal?.close()}
				>Keep editing</Button
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
				Discard changes
			</Button>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button type="submit">close</button>
	</form>
</dialog>
