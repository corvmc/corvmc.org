<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import type { RemoteForm } from '@sveltejs/kit';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchEvents } from '$lib/remote/events.remote';
	import { searchWorkAssets } from '$lib/remote/maintenance-schedules.remote';
	import { VOLUNTEER_SHIFT_TITLE_MAX, VOLUNTEER_SHIFT_NOTES_MAX } from '$lib/config';

	/** The shape SearchSelect hands back, and the shape an edit form seeds it with. */
	type ShiftEvent = { id: string; title: string; when?: string };
	type ShiftAsset = { id: string; name: string; detail?: string | null };

	let {
		form,
		roles,
		roleId = $bindable(''),
		lockedEvent,
		initialEvent = null,
		initialAsset = null,
		startsAt,
		endsAt,
		capacity,
		notes,
		title,
		timed = true
	}: {
		/**
		 * The remote form this field set posts into — `createShift`, or
		 * `updateShift.for(id)`. Taken as a prop only so the event picker can build
		 * its hidden input from `form.fields`; see the comment on it below.
		 */
		/*
		 * `RemoteForm<Input, Output>` is invariant in `Input` — it appears
		 * covariantly in `fields` and contravariantly in `preflight`/`enhance` —
		 * so a container that accepts more than one remote form has no single
		 * generic instantiation. Expressing "some remote form, I don't care
		 * which" needs an existential type, which TypeScript does not have.
		 *
		 * Generics were tried and reverted; three call sites pass `createShift` (no `id`)
		 * and a fourth passes `updateShift.for(id)` (has one), proves the point.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		form: RemoteForm<any, any> | Omit<RemoteForm<any, any>, 'for'>;
		/** Roles to choose from. Omit to lock the shift to `roleId`. */
		roles?: { id: string; name: string }[];
		roleId?: string;
		/**
		 * Fixes the shift to one show and drops the picker — what the event page's
		 * own "Schedule a shift" wants, where the answer is already known.
		 */
		lockedEvent?: { id: string; title: string };
		/** The event already attached, for an edit form. */
		initialEvent?: ShiftEvent | null;
		/** The inventory unit already linked, for an edit form. */
		initialAsset?: ShiftAsset | null;
		startsAt: string;
		endsAt: string;
		capacity: string;
		notes?: string;
		/** The shift's own name. Blank falls back to the event, then the role. */
		title?: string;
		/**
		 * Off for a work order with no time yet: a deadline replaces the window, and
		 * the event picker goes, since `createWorkOrder` only ties a timed one to a show.
		 */
		timed?: boolean;
	} = $props();

	// Seeded once and then owned by the picker. `untrack` says that on purpose:
	// `initialEvent` is where this shift's event *was* when the form opened, not a
	// value the form should keep snapping back to while somebody edits it.
	let selectedEvent = $state<ShiftEvent | null>(untrack(() => initialEvent));
	let selectedAsset = $state<ShiftAsset | null>(untrack(() => initialAsset));
</script>

{#if roles}
	<FormField
		field={form.fields.volunteerRoleId}
		label={m.volunteer_shift_form_fields_role()}
		type="select"
		bind:value={roleId}
		options={roles.map((r) => ({ value: r.id, label: r.name }))}
	/>
{:else}
	<input {...form.fields.volunteerRoleId.as('hidden', roleId)} />
{/if}

{#if lockedEvent}
	<input {...form.fields.eventId.as('hidden', lockedEvent.id)} />
{:else if timed}
	<!--
		Rendered unconditionally, even with nothing picked, and that is the whole
		point: `updateShift` writes `eventId` only when the key is *present*, so an
		absent field reads as "untouched", not "cleared". SearchSelect's own `name`
		prop emits its hidden input only while something is selected — wire the
		picker up that way and an event can be attached and then never removed,
		with the form cheerfully reporting success either time.

		It comes from `form.fields` rather than a hand-written `name` so the field
		name stays whatever the remote form encodes it as.
	-->
	<input {...form.fields.eventId.as('hidden', selectedEvent?.id ?? '')} />
	<FormField
		field={form.fields.eventId}
		label={m.volunteer_shift_form_fields_event()}
		description={m.volunteer_shift_form_fields_optional_work_parties_repair_day()}
	>
		<!-- Children rather than the `input` snippet: that snippet's argument is the
		     id of the one control the caption labels, and SearchSelect has no single
		     control to give it — its combobox input is replaced by a chip as soon as
		     something is picked. So this field keeps its `<legend>`. -->
		<SearchSelect
			search={(q) => searchEvents(q)}
			bind:value={selectedEvent}
			labelKey="title"
			descriptionKey="when"
			placeholder={m.volunteer_shift_form_fields_search_events_by_title()}
		/>
	</FormField>
{/if}

<!-- Always rendered, like the event's: an empty value is how a link is removed. -->
<input {...form.fields.assetId.as('hidden', selectedAsset?.id ?? '')} />
<FormField
	field={form.fields.assetId}
	label={m.volunteer_shift_form_fields_equipment()}
	description={m.volunteer_shift_form_fields_optional_unit_work_about_such()}
>
	<SearchSelect
		search={(q) => searchWorkAssets(q)}
		bind:value={selectedAsset}
		labelKey="name"
		descriptionKey="detail"
		placeholder={m.volunteer_shift_form_fields_search_by_item_tag_serial()}
	/>
</FormField>

<!--
	Under the event picker, because the two answer the same question and the
	event usually answers it. A shift with a show borrows its title; one without
	had nothing but the role name, so two work parties on one Saturday read
	identically on the board.
-->
<FormField
	field={form.fields.title}
	label={m.volunteer_shift_form_fields_name()}
	value={title}
	maxlength={String(VOLUNTEER_SHIFT_TITLE_MAX)}
	description={m.volunteer_shift_form_fields_optional_leave_blank_use_event()}
/>

{#if timed}
	<FormField
		field={form.fields.startsAt}
		label={m.volunteer_shift_form_fields_starts()}
		type="datetime-local"
		value={startsAt}
	/>
	<FormField
		field={form.fields.endsAt}
		label={m.volunteer_shift_form_fields_ends()}
		type="datetime-local"
		value={endsAt}
	/>
{:else}
	<FormField
		field={form.fields.dueAt}
		label={m.volunteer_shift_form_fields_due_by()}
		type="datetime-local"
		description={m.volunteer_shift_form_fields_optional_waits_unscheduled_work()}
	/>
{/if}
<FormField
	field={form.fields.capacity}
	submitAs="text"
	label={m.volunteer_shift_form_fields_people_needed()}
	type="number"
	min="1"
	value={capacity}
	description={m.volunteer_shift_form_fields_claims_beyond_refused()}
/>
<FormField
	field={form.fields.notes}
	label={m.volunteer_shift_form_fields_anything_they_should_know()}
	type="textarea"
	value={notes}
	description={m.volunteer_shift_form_fields_where_meet_what_bring_shown({
		VOLUNTEER_SHIFT_NOTES_MAX
	})}
/>
