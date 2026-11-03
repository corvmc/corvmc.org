<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * Name the filter combination you are looking at, and keep it as a tab.
	 *
	 * The filters go over as the same JSON the URL carries, so a saved view and a
	 * bookmark of this page describe the same thing — which is why saving one
	 * needs nothing but a name.
	 */
	import Modal from '$lib/components/ui/Modal.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { saveInboxView } from '$lib/remote/inbox.remote';
	import { filters } from './filters.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	// Only the keys a saved view remembers; `page` is where you happened to be,
	// not part of what the view means.
	const payload = $derived(
		JSON.stringify({
			view: filters.view,
			channel: filters.channel || undefined,
			assigned: filters.assigned || undefined,
			subject: filters.subject || undefined,
			waitingDays: filters.waitingDays || undefined,
			q: filters.search || undefined
		})
	);
</script>

<Modal bind:open title={m.staff_save_as_view()} maxWidth="max-w-sm">
	<Form
		remote={saveInboxView}
		successToast={m.staff_inbox_save_view_dialog_success_toast()}
		onsuccess={() => (open = false)}
		class="flex flex-col gap-4"
	>
		<input {...saveInboxView.fields.filters.as('hidden', payload)} />
		<FormField
			field={saveInboxView.fields.name}
			label={m.staff_name()}
			placeholder={m.staff_inbox_save_view_dialog_placeholder()}
		/>
		<div class="flex justify-end">
			<SubmitButton
				label={m.staff_inbox_save_view_dialog_save_view()}
				successLabel={m.staff_saved()}
			/>
		</div>
	</Form>
</Modal>
