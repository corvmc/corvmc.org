<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import Button from '$lib/components/ui/Button.svelte';
	import { createEvent, getProgramGroups } from '$lib/remote/events.remote';
	import { createShow } from '$lib/remote/productions.remote';
	import { clubToday } from '$lib/config';

	/**
	 * Only what the row cannot exist without (#1822's rule); the listing page
	 * holds the rest, and no production is opened. `production` is "New
	 * production" making its listing instead: it posts `createShow`, which fixes
	 * the kind to a show, opens the production with it, and lands on the console.
	 */
	let {
		open = $bindable(false),
		title: modalTitle = 'New Event',
		submitLabel = 'Create Event',
		production = false
	}: { open: boolean; title?: string; submitLabel?: string; production?: boolean } = $props();

	let title = $state('');
	let kind = $state('show');
	let groupId = $state('');
	let eventDate = $state(clubToday());
	let eventStartTime = $state('');
	let eventEndTime = $state('');

	// Loaded when the modal opens, not with the page that mounts it.
	let programs = $state<{ id: string; name: string }[]>([]);
	$effect(() => {
		if (!open || production) return;
		getProgramGroups().then((rows) => (programs = rows));
	});

	async function handleSuccess(result?: { eventId?: string }) {
		open = false;
		resetForm();
		await invalidateAll();
		if (!result?.eventId) return;
		if (production) {
			goto(resolve(`/staff/events/${result.eventId}/production`));
		} else {
			// `edit` opens the page's edit card, so the next field is one click closer.
			goto(withQuery(resolve(`/staff/events/${result.eventId}`), 'edit=1'));
		}
	}

	function resetForm() {
		title = '';
		kind = 'show';
		groupId = '';
		eventDate = clubToday();
		eventStartTime = '';
		eventEndTime = '';
	}
</script>

<Modal bind:open title={modalTitle} maxWidth="max-w-md" onclose={resetForm}>
	<svelte:boundary>
		<Form
			remote={production ? createShow : createEvent}
			successToast={production ? 'Production opened' : 'Event created'}
			onsuccess={handleSuccess}
			class="space-y-4"
		>
			<Field name="title" type="text" label="Title" bind:value={title} />
			{#if !production}
				<Field
					name="kind"
					type="select"
					label="Kind"
					bind:value={kind}
					options={[
						{ value: 'show', label: 'Show' },
						{ value: 'work_party', label: 'Work party' },
						{ value: 'meeting', label: 'Meeting' },
						{ value: 'class', label: 'Class' },
						{ value: 'market', label: 'Market' }
					]}
					description="Only shows reach the homepage posters. Anything published still appears on the public calendar."
				/>
				{#if programs.length > 0}
					<Field
						name="groupId"
						type="select"
						label="Run by"
						bind:value={groupId}
						options={[
							{ value: '', label: 'CMC' },
							...programs.map((g) => ({ value: g.id, label: g.name }))
						]}
						description="The committee or club behind it — a work party is Facilities', outreach is Development's. Leave it on CMC for a show."
					/>
				{/if}
			{/if}
			<Field name="eventDate" type="date" label="Date" bind:value={eventDate} />

			<div class="grid grid-cols-2 gap-4">
				<Field name="eventStartTime" type="time" label="Start time" bind:value={eventStartTime} />
				<Field name="eventEndTime" type="time" label="End time" bind:value={eventEndTime} />
			</div>

			<p class="text-muted">
				{#if production}
					Saved as a draft show with its production. The console opens next; the listing's
					description, poster and tickets are on the event's page.
				{:else}
					Saved as a draft. Description, poster, tickets and the room are filled in on the event's
					page next.
				{/if}
			</p>

			<div class="modal-action">
				<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
				<SubmitButton label={submitLabel} />
			</div>
		</Form>

		{#snippet pending()}
			<div class="flex items-center justify-center p-8">
				<span class="loading loading-md loading-spinner"></span>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<Alert type="warning" {reset}>Could not load the event form: {errorMessage(error)}</Alert>
		{/snippet}
	</svelte:boundary>
</Modal>
