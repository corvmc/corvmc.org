<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import {
		BandPublishEventAction,
		BandUnpublishEventAction,
		BandCancelEventAction,
		RemoveEventPosterAction
	} from '$lib/components/shared/actions';
	import EventFields from '../EventFields.svelte';
	import { type LineupChip } from '../LineupEditor.svelte';
	import { invalidateAll } from '$app/navigation';
	import { getBandEventDetail, updateBandEventForm } from '$lib/remote/band-events.remote';
	import { getBandLayout } from '$lib/remote/layout.remote';
	import { page } from '$app/state';

	// Declared before the awaited queries below: a declaration that follows a
	// top-level await is async-gated, which would compile every `fields.X.as()`
	// in EventFields into an async derived (the churn behind
	// JAVASCRIPT-SVELTEKIT-W). It reaches that component as a resolved prop.
	const updateFields = updateBandEventForm.fields;

	let layout = $derived(await getBandLayout(page.params.slug!));
	let evt = $derived(
		await getBandEventDetail({ slug: page.params.slug!, eventId: page.params.eventId! })
	);
	const band = $derived(layout.band);
	const isAdmin = $derived(layout.userRole === 'owner' || layout.userRole === 'admin');

	// `isAdmin` alone offered Publish / Cancel / Edit on a bill this band is only
	// *credited* on — the `guest` badge on the events list. Every one of those
	// forms re-checks `evt.bandId !== band.id` on the server and throws 404, so
	// the buttons were there to fail. Ownership has to be part of the gate.
	const canEdit = $derived(isAdmin && evt.isOwner && evt.status !== 'cancelled');

	// The act that owns the bill, for the line a guest band sees in place of
	// actions it doesn't have.
	const ownerActName = $derived(evt.lineup.find((l) => l.bandId && l.bandId !== band.id)?.name);

	// Seeded from the saved bill so an edit that doesn't touch the lineup
	// round-trips it unchanged rather than wiping it. Writable derived: edits
	// stick, but reloading the event resets to what the server has.
	let lineup = $derived<LineupChip[]>(
		evt.lineup.map((l) => ({
			name: l.name,
			bandId: l.bandId ?? undefined,
			status: l.status
		}))
	);
</script>

<!--
	The page *is* the edit form. It used to be a read-only definition list, then a
	row of five sibling <form> elements, then an edit card that a toggle appended
	*below* all of it — so changing anything cost two clicks and a scroll past the
	copy you were trying to correct.

	Someone who can't edit gets this same template with `readonly` passed down,
	rather than a second layout that has to be kept in step with this one.
-->
<Form
	remote={updateBandEventForm}
	guard
	successToast="Event updated"
	onsuccess={() => invalidateAll()}
>
	<PageHeader title={evt.title} subtitle={band.name}>
		<StatusBadge status={evt.status} />
		{#if canEdit}
			<SubmitButton label="Save" shortcut="mod+s" />
			<details class="dropdown dropdown-end">
				<summary class="btn btn-ghost btn-sm">More</summary>
				<div
					class="dropdown-content z-10 flex w-56 flex-col gap-1 rounded-box bg-base-100 p-2 shadow"
				>
					{#if evt.status === 'draft'}
						<BandPublishEventAction eventId={evt.id} class="justify-start" />
					{:else if evt.status === 'published'}
						<BandUnpublishEventAction eventId={evt.id} class="justify-start" />
					{/if}
					{#if evt.posterUrl}
						<RemoveEventPosterAction eventId={evt.id} class="justify-start" />
					{/if}
					<BandCancelEventAction eventId={evt.id} outline class="justify-start" />
				</div>
			</details>
		{/if}
	</PageHeader>

	<PageContent width="2xl">
		{#if !evt.isOwner}
			<p class="text-muted text-sm">
				Your band is credited on this bill{ownerActName ? `, added by ${ownerActName}` : ''}. Only
				the band that created the listing can change it.
			</p>
		{:else if evt.status === 'cancelled'}
			<p class="text-muted text-sm">This event is cancelled, so it can no longer be edited.</p>
		{:else if !isAdmin}
			<p class="text-muted text-sm">Band admins can edit this event.</p>
		{/if}

		<input {...updateFields.eventId.as('hidden', evt.id)} />

		<InfoCard title="Event details">
			<div class="space-y-4">
				<EventFields fields={updateFields} {evt} bandId={band.id} bind:lineup readonly={!canEdit} />
			</div>
		</InfoCard>
	</PageContent>
</Form>
