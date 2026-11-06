<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import {
		BandPublishEventAction,
		BandUnpublishEventAction,
		BandCancelEventAction,
		RemoveEventPosterAction
	} from '#lib/components/actions/index.js';
	import EventFields from '../EventFields.svelte';
	import TicketSaleCard from './TicketSaleCard.svelte';
	import DoorListCard from './DoorListCard.svelte';
	import { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import { refreshAll } from '$app/navigation';
	import { getBandEventDetail, updateBandEventForm } from '#lib/remote/band-events.remote.js';
	import { getBandLayoutContext } from '../../layout-context';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug', 'eventId');

	// Declared before the awaited queries below: a declaration that follows a
	// top-level await is async-gated, which would compile every `fields.X.as()`
	// in EventFields into an async derived (the churn behind
	// JAVASCRIPT-SVELTEKIT-W). It reaches that component as a resolved prop.
	const updateFields = updateBandEventForm.fields;

	// The layout above already holds this; re-awaiting it here was a second remote query
	// in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	let evt = $derived(await getBandEventDetail({ slug: params.slug, eventId: params.eventId }));
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
	successToast={m.band_slug_events_event_id_success_toast()}
	onsuccess={() => refreshAll()}
>
	<PageHeader width="2xl" title={evt.title} subtitle={band.name}>
		<StatusBadge status={evt.status} />
		{#if canEdit}
			<SubmitButton label={m.band_save()} shortcut="mod+s" />
			<details class="dropdown dropdown-end">
				<summary class="btn btn-ghost btn-sm">{m.band_slug_events_event_id_more()}</summary>
				<div class="dropdown-content dropdown-panel flex w-56 flex-col gap-1">
					{#if evt.status === 'draft'}
						<BandPublishEventAction slug={band.slug} eventId={evt.id} class="justify-start" />
					{:else if evt.status === 'published'}
						<BandUnpublishEventAction slug={band.slug} eventId={evt.id} class="justify-start" />
					{/if}
					{#if evt.posterUrl}
						<RemoveEventPosterAction slug={band.slug} eventId={evt.id} class="justify-start" />
					{/if}
					<BandCancelEventAction slug={band.slug} eventId={evt.id} outline class="justify-start" />
				</div>
			</details>
		{/if}
	</PageHeader>

	<PageContent width="2xl">
		{#if !evt.isOwner}
			<p class="text-muted text-sm">
				{ownerActName
					? m.band_slug_events_event_id_credited_added_by({ name: ownerActName })
					: m.band_slug_events_event_id_credited()}
			</p>
		{:else if evt.status === 'cancelled'}
			<p class="text-muted text-sm">{m.band_slug_events_event_id_event_cancelled_so_can_no()}</p>
		{:else if !isAdmin}
			<p class="text-muted text-sm">{m.band_slug_events_event_id_band_admins_can_edit_event()}</p>
		{/if}

		<input {...updateFields.slug.as('hidden', band.slug)} />
		<input {...updateFields.eventId.as('hidden', evt.id)} />

		<InfoCard title={m.band_slug_events_event_id_title()}>
			<div class="space-y-4">
				<EventFields
					fields={updateFields}
					{evt}
					slug={band.slug}
					bandId={band.id}
					bind:lineup
					readonly={!canEdit}
				/>
			</div>
		</InfoCard>
	</PageContent>
</Form>

{#if canEdit}
	<PageContent width="2xl">
		<TicketSaleCard slug={band.slug} eventId={evt.id} />
		<DoorListCard slug={band.slug} eventId={evt.id} />
	</PageContent>
{/if}
