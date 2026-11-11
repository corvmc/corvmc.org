<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { createEvent, getProgramGroups } from '#lib/remote/events.remote.js';
	import { createShow } from '#lib/remote/productions.remote.js';
	import { clubToday } from '#lib/config.js';

	/**
	 * Only what the row cannot exist without (#1822's rule); the listing page
	 * holds the rest, and no production is opened. `production` is "New
	 * production" making its listing instead: it posts `createShow`, which fixes
	 * the kind to a show, opens the production with it, and lands on the console.
	 */
	let {
		open = $bindable(false),
		title: modalTitle = m.events_create_event_modal_title(),
		submitLabel = m.events_create_event_modal_submit_label(),
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
		await refreshAll();
		if (!result?.eventId) return;
		if (production) {
			goto(resolve(`staff/events/${result.eventId}/production`));
		} else {
			// `edit` opens the page's edit card, so the next field is one click closer.
			goto(withQuery(resolve(`staff/events/${result.eventId}`), 'edit=1'));
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
			successToast={production
				? m.events_create_event_modal_production_opened_toast()
				: m.events_create_event_modal_event_created_toast()}
			onsuccess={handleSuccess}
			class="space-y-4"
		>
			<Field
				field={(production ? createShow : createEvent).fields.title}
				type="text"
				label={m.events_title_label()}
				bind:value={title}
			/>
			{#if !production}
				<Field
					field={createEvent.fields.kind}
					type="select"
					label={m.events_kind_label()}
					bind:value={kind}
					options={[
						{ value: 'show', label: m.events_show_label() },
						{ value: 'work_party', label: m.events_work_party_label() },
						{ value: 'meeting', label: m.events_meeting_label() },
						{ value: 'class', label: m.events_class_label() },
						{ value: 'market', label: m.events_market_label() }
					]}
					description={m.events_only_shows_reach_homepage_posters_body()}
				/>
				{#if programs.length > 0}
					<Field
						field={createEvent.fields.groupId}
						type="select"
						label={m.events_create_event_modal_run_by_label()}
						bind:value={groupId}
						options={[
							{ value: '', label: m.events_cmc_label() },
							...programs.map((g) => ({ value: g.id, label: g.name }))
						]}
						description={m.events_create_event_modal_committee_club_behind_work_party_body()}
					/>
				{/if}
			{/if}
			<Field
				field={(production ? createShow : createEvent).fields.eventDate}
				type="date"
				label={m.events_date_label()}
				bind:value={eventDate}
			/>

			<div class="grid grid-cols-2 gap-4">
				<Field
					field={(production ? createShow : createEvent).fields.eventStartTime}
					type="time"
					label={m.events_start_time_label()}
					bind:value={eventStartTime}
				/>
				<Field
					field={(production ? createShow : createEvent).fields.eventEndTime}
					type="time"
					label={m.events_end_time_label()}
					bind:value={eventEndTime}
				/>
			</div>

			<p class="text-muted">
				{#if production}{m.events_create_event_modal_saved_as_draft_show_with_text()}{:else}{m.events_create_event_modal_saved_as_draft_description_poster_text()}{/if}
			</p>

			<div class="modal-action">
				<Button type="button" variant="ghost" onclick={() => (open = false)}
					>{m.events_cancel_label()}</Button
				>
				<SubmitButton label={submitLabel} />
			</div>
		</Form>

		{#snippet pending()}
			<div class="flex items-center justify-center p-8">
				<span class="loading loading-md loading-spinner"></span>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<Alert type="warning" {reset}
				>{m.events_create_event_modal_could_not_load_event_form_body({
					errorMessage: errorMessage(error)
				})}</Alert
			>
		{/snippet}
	</svelte:boundary>
</Modal>
