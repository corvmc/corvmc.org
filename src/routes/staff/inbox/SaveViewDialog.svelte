<script lang="ts">
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

<Modal bind:open title="Save as view" maxWidth="max-w-sm">
	<Form
		remote={saveInboxView}
		successToast="View saved"
		onsuccess={() => (open = false)}
		class="flex flex-col gap-4"
	>
		<input {...saveInboxView.fields.filters.as('hidden', payload)} />
		<FormField name="name" label="Name" placeholder="Practice space, unanswered" />
		<div class="flex justify-end">
			<SubmitButton label="Save view" successLabel="Saved" />
		</div>
	</Form>
</Modal>
