<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Button from '$lib/components/ui/Button.svelte';
	import CreateEventModal from '$lib/components/events/CreateEventModal.svelte';
	import { createProduction, getAttachableListings } from '$lib/remote/productions.remote';
	import { formatDateTimeShort } from '$lib/utils/format';

	/**
	 * A production is the back-of-house of a show already on the calendar, so
	 * this attaches one to a listing first. A show that is not listed yet is
	 * made through the Calendar's own listing form, in its production mode.
	 */
	let { open = $bindable(false) }: { open: boolean } = $props();

	let creating = $state(false);
	let eventId = $state('');
	let listings = $state<{ id: string; title: string; startsAt: Date }[] | null>(null);

	// Loaded when the modal opens, not with the page that mounts it.
	$effect(() => {
		if (!open) return;
		getAttachableListings().then((rows) => {
			listings = rows;
			if (!rows.some((r) => r.id === eventId)) eventId = rows[0]?.id ?? '';
		});
	});

	function createListing() {
		open = false;
		creating = true;
	}

	function handleSuccess() {
		const id = eventId;
		open = false;
		if (id) goto(resolve(`/staff/events/${id}/production`));
	}
</script>

<Modal bind:open title="New Production" maxWidth="max-w-md">
	{#if listings === null}
		<div class="flex items-center justify-center p-8">
			<span class="loading loading-md loading-spinner"></span>
		</div>
	{:else if listings.length === 0}
		<p class="text-muted">No show on the calendar is waiting for a production.</p>
		<div class="modal-action">
			<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button type="button" variant="primary" onclick={createListing}>Create a listing</Button>
		</div>
	{:else}
		<Form
			remote={createProduction}
			successToast="Production opened"
			onsuccess={handleSuccess}
			class="space-y-4"
		>
			<Field
				name="eventId"
				type="select"
				label="Listing"
				bind:value={eventId}
				options={listings.map((l) => ({
					value: l.id,
					label: `${l.title} · ${formatDateTimeShort(l.startsAt)}`
				}))}
				description="Upcoming shows on the calendar without a production."
			/>
			<div class="modal-action">
				<Button type="button" variant="ghost" onclick={createListing}>Create a listing</Button>
				<SubmitButton label="Open production" />
			</div>
		</Form>
	{/if}
</Modal>

<CreateEventModal
	bind:open={creating}
	production
	title="New Production"
	submitLabel="Create Listing"
/>
