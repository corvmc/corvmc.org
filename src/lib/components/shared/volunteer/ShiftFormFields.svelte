<script lang="ts">
	import { untrack } from 'svelte';
	import type { RemoteForm } from '@sveltejs/kit';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SearchSelect from '$lib/components/shared/Form/SearchSelect.svelte';
	import { searchEvents } from '$lib/remote/events.remote';
	import { VOLUNTEER_SHIFT_NOTES_MAX } from '$lib/config';

	/** The shape SearchSelect hands back, and the shape an edit form seeds it with. */
	type ShiftEvent = { id: string; title: string; when?: string };

	let {
		form,
		roles,
		roleId = $bindable(''),
		lockedEvent,
		initialEvent = null,
		startsAt,
		endsAt,
		capacity,
		notes
	}: {
		/**
		 * The remote form this field set posts into — `createShift`, or
		 * `updateShift.for(id)`. Taken as a prop only so the event picker can build
		 * its hidden input from `form.fields`; see the comment on it below.
		 */
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
		startsAt: string;
		endsAt: string;
		capacity: string;
		notes?: string;
	} = $props();

	// Seeded once and then owned by the picker. `untrack` says that on purpose:
	// `initialEvent` is where this shift's event *was* when the form opened, not a
	// value the form should keep snapping back to while somebody edits it.
	let selectedEvent = $state<ShiftEvent | null>(untrack(() => initialEvent));
</script>

{#if roles}
	<FormField
		name="volunteerRoleId"
		label="Role"
		type="select"
		bind:value={roleId}
		options={roles.map((r) => ({ value: r.id, label: r.name }))}
	/>
{:else}
	<input type="hidden" name="volunteerRoleId" value={roleId} />
{/if}

{#if lockedEvent}
	<input {...form.fields.eventId.as('hidden', lockedEvent.id)} />
{:else}
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
		name="eventId"
		label="Event"
		description="Optional — work parties and repair days aren't tied to a show."
	>
		{#snippet input()}
			<SearchSelect
				search={(q) => searchEvents(q)}
				bind:value={selectedEvent}
				labelKey="title"
				descriptionKey="when"
				placeholder="Search events by title..."
			/>
		{/snippet}
	</FormField>
{/if}

<FormField name="startsAt" label="Starts" type="datetime-local" value={startsAt} />
<FormField name="endsAt" label="Ends" type="datetime-local" value={endsAt} />
<FormField
	name="capacity"
	label="People needed"
	type="number"
	min="1"
	value={capacity}
	description="Claims beyond this are refused."
/>
<FormField
	name="notes"
	label="Anything they should know"
	type="textarea"
	value={notes}
	description="Where to meet, what to bring — shown when they claim it. Up to {VOLUNTEER_SHIFT_NOTES_MAX} characters."
/>
