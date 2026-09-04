<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import LineupEditor, { type LineupChip } from '$lib/components/events/LineupEditor.svelte';
	import {
		PublishEventAction,
		UnpublishEventAction,
		CancelEventAction,
		DeleteEventAction
	} from '$lib/components/actions';
	import { getStaffEventPage, updateEvent, setStaffEventLineup } from '$lib/remote/events.remote';
	import { rejectListing, searchBandsForListing } from '$lib/remote/community-events.remote';
	import { rowLink } from '$lib/actions/row-link';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import { formatTime, fullDate, toLocalDate, toLocalTime } from '$lib/utils/format';

	/**
	 * The general view of an event — every source, any staffer.
	 *
	 * This is the address `entity-href` resolves every event ref to, so it is
	 * where a staffer lands by default from anywhere in the panel: a volunteer
	 * shift, a reservation, a member's record, a notification. That is why it
	 * holds the *least privileged* useful view rather than the richest one. The
	 * production console is a page you navigate to, at `[id]/production`, and can
	 * be gated on its own without making every inbound link conditional.
	 *
	 * It owns the event's lifecycle — publish, approve, turn down, unpublish,
	 * cancel, delete — and the console owns the production. One rule, so nobody
	 * has to remember which page a button lives on.
	 */
	const id = $derived(page.params.id!);
	const data = $derived(await getStaffEventPage(id));
	const evt = $derived(data.detail.event);
	const detail = $derived(data.detail);

	const isProduction = $derived(evt.source === 'cmc');
	const isBandEvent = $derived(evt.source === 'band');
	const isCommunityEvent = $derived(evt.source === 'community');

	const rejectFields = rejectListing.fields;
	const { fields } = updateEvent;

	function refresh() {
		void getStaffEventPage(id).refresh();
	}

	// ── Edit ──────────────────────────────────────────────────────────────
	// Trimmed on purpose: no ticketing toggle, no capacity, no reservation
	// rebooking. Those are production controls and live on the console. What is
	// here is what a reviewer needs to fix a typo before approving.
	let editing = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');
	let editTags = $state('');
	let editKind = $state('show');
	let editLocation = $state('');
	let editVenueId = $state('');
	let editExternalTicketUrl = $state('');
	let editDate = $state('');
	let editStartTime = $state('');
	let editEndTime = $state('');
	let editDoorsTime = $state('');
	let lineup = $state<LineupChip[]>([]);

	function startEditing() {
		editTitle = evt.title;
		editDescription = evt.description ?? '';
		editTags = evt.tags ?? '';
		editKind = evt.kind ?? 'show';
		editLocation = evt.location ?? '';
		editVenueId = evt.venueId ?? '';
		editExternalTicketUrl = evt.externalTicketUrl ?? '';
		editDate = toLocalDate(evt.startsAt);
		editStartTime = toLocalTime(evt.startsAt);
		editEndTime = evt.endsAt ? toLocalTime(evt.endsAt) : '';
		editDoorsTime = evt.doorsAt ? toLocalTime(evt.doorsAt) : '';
		lineup = detail.lineup.map((l) => ({ name: l.name, bandId: l.bandId ?? undefined }));
		editing = true;
	}

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}
</script>

<PageHeader title={evt.title} subtitle="Event" backHref="/staff/events">
	<div class="flex flex-wrap items-center gap-2">
		{#if isProduction}
			<Button href={resolve(`/staff/events/${id}/production`)} variant="default" size="sm" outline>
				Manage production
			</Button>
		{/if}

		{#if evt.ticketingEnabled}
			<Button href="/staff/events/{evt.id}/check-in" variant="ghost" size="sm">Check-in</Button>
		{/if}

		{#if evt.status !== 'cancelled' && !editing}
			<Button variant="ghost" size="sm" onclick={startEditing}>Edit</Button>
		{/if}

		{#if evt.status === 'draft'}
			<PublishEventAction eventId={evt.id} />
		{/if}

		{#if evt.status === 'pending_review'}
			<!-- Approving is the same transition as publishing a draft, so it goes
			     through the same action. Turning it down is its own thing: it needs
			     a reason, because `rejected` exists so the member can fix and
			     resubmit. -->
			<PublishEventAction eventId={evt.id} label="Approve" />
			<Action
				action={rejectListing}
				label="Turn down"
				successToast="Sent back to the member"
				variant="warning"
				size="sm"
				onsuccess={() => invalidateAll()}
			>
				{#snippet form()}
					<input {...rejectFields.eventId.as('hidden', evt.id)} />
					<FormField
						field={rejectFields.notes}
						type="textarea"
						label="What needs to change?"
						description="The member sees this. Without it they can't fix the listing."
					/>
				{/snippet}
			</Action>
		{/if}

		{#if evt.status === 'published'}
			<UnpublishEventAction eventId={evt.id} />
		{/if}

		{#if evt.status !== 'cancelled'}
			<CancelEventAction eventId={evt.id} />
		{/if}

		<DeleteEventAction eventId={evt.id} />
	</div>
</PageHeader>

<PageContent width="3xl">
	<div class="flex flex-wrap items-center gap-2">
		<StatusBadge status={evt.status} label />
		{#if evt.publishedAt}
			<span class="text-muted">Published {fullDate(evt.publishedAt)}</span>
		{/if}
	</div>

	<!-- What was already said, before saying it again. -->
	{#if evt.status === 'rejected' && evt.reviewNotes}
		<Alert type="warning">
			Turned down. Staff note: "{evt.reviewNotes}"
		</Alert>
	{/if}

	<!--
		Who is accountable, which is a different record per source: a band manages
		its own gig, a member owns their listing, and the collective's own shows
		answer with neither. This also absorbs what used to be a second "Created
		by" card saying the same name and email over again.
	-->
	<InfoCard title="Posted by">
		{#if isProduction}
			<p class="text-sm font-medium">CMC</p>
		{:else if isBandEvent}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				{#if detail.bandRef}
					<EntityChip ref={detail.bandRef} />
				{:else}
					<span class="font-medium">a band</span>
				{/if}
			</p>
		{:else}
			<p class="flex flex-wrap items-center gap-2 text-sm">
				<a href={resolve(`/staff/users/${detail.submitterId}`)} class="link font-medium">
					{detail.creator?.name ?? 'Unknown member'}
				</a>
				{#if detail.creator?.email}
					<span class="text-muted">{detail.creator.email}</span>
				{/if}
			</p>
		{/if}

		<p class="mt-1 text-muted">Submitted {fullDate(evt.createdAt)}</p>

		<!-- Community only: standing is a member-level fact, and whether a band
		     can be flagged the same way is a different axis. -->
		{#if isCommunityEvent && detail.submitterStanding && detail.submitterStanding.status !== 'none'}
			<Alert type="warning" class="mt-2">
				This member's listings are checked before they publish, after a report was upheld against
				one of them.
				{#if detail.submitterStanding.reason}
					Staff note: "{detail.submitterStanding.reason}"
				{/if}
			</Alert>
		{/if}
	</InfoCard>

	{#if editing}
		<InfoCard title="Edit">
			<Form remote={updateEvent} guard successToast="Updated" onsuccess={() => (editing = false)}>
				<input {...fields.eventId.as('hidden', evt.id)} />
				<div class="space-y-4">
					<FormField field={fields.title} label="Title" bind:value={editTitle} />
					<FormField
						field={fields.description}
						type="textarea"
						label="Description"
						bind:value={editDescription}
					/>
					<div class="grid gap-4 sm:grid-cols-2">
						<FormField field={fields.eventDate} type="date" label="Date" bind:value={editDate} />
						<FormField
							field={fields.doorsTime}
							type="time"
							label="Doors"
							bind:value={editDoorsTime}
						/>
						<FormField
							field={fields.eventStartTime}
							type="time"
							label="Start"
							bind:value={editStartTime}
						/>
						<FormField
							field={fields.eventEndTime}
							type="time"
							label="End"
							bind:value={editEndTime}
						/>
					</div>
					<!--
						Two fields, not one, and both keep working. `venueId` is what the
						reservation question reads — a show anywhere but our room holds no
						space — while `location` stays the free-text line the gig guide has
						always printed, and the only thing a band listing ever has.
					-->
					{#if data.venues.length > 0}
						<FormField
							field={fields.venueId}
							type="select"
							label="Venue"
							bind:value={editVenueId}
							options={[
								{ value: '', label: 'The practice room' },
								...data.venues
									.filter((v) => !v.isPrimary)
									.map((v) => ({ value: v.id, label: v.name }))
							]}
						/>
					{/if}
					<FormField field={fields.location} label="Address line" bind:value={editLocation} />
					<FormField
						field={fields.externalTicketUrl}
						label="Ticket link"
						bind:value={editExternalTicketUrl}
					/>
					<FormField field={fields.tags} label="Tags" bind:value={editTags} />
					<FormField
						field={fields.kind}
						type="select"
						label="Kind"
						bind:value={editKind}
						options={[
							{ value: 'show', label: 'Show' },
							{ value: 'work_party', label: 'Work party' },
							{ value: 'meeting', label: 'Meeting' },
							{ value: 'class', label: 'Class' }
						]}
						description="Only shows reach the homepage posters. Anything published still appears on the public calendar."
					/>
				</div>
				<div class="mt-4 flex gap-2">
					<SubmitButton label="Save" />
					<Button variant="ghost" size="sm" onclick={() => (editing = false)}>Cancel</Button>
				</div>
			</Form>

			<!--
				The bill saves separately. `setStaffEventLineup` decides consent from
				the event's source, and folding it into `updateEvent` would put that
				rule behind a form the console also posts.
			-->
			<div class="mt-6 border-t border-base-200 pt-4">
				<Form
					remote={setStaffEventLineup}
					successToast="Bill updated"
					onsuccess={() => {
						editing = false;
						refresh();
					}}
				>
					<input {...setStaffEventLineup.fields.eventId.as('hidden', evt.id)} />
					<input {...setStaffEventLineup.fields.lineup.as('hidden', JSON.stringify(lineup))} />
					<LineupEditor bind:value={lineup} search={searchBandsForListing} />
					<div class="mt-3"><SubmitButton label="Save bill" /></div>
				</Form>
			</div>
		</InfoCard>
	{/if}

	<InfoCard title="Event">
		<p class="text-xl font-medium">{fullDate(evt.startsAt)}</p>
		<p class="text-muted">
			{#if evt.doorsAt}
				Doors {formatTime(evt.doorsAt)} · Show {formatEventTimeRange(evt.startsAt, evt.endsAt)}
			{:else}
				{formatEventTimeRange(evt.startsAt, evt.endsAt)}
			{/if}
		</p>

		{#if evt.location}
			<p class="text-muted">{evt.location}</p>
		{/if}

		{#if evt.externalTicketUrl}
			<a
				href={evt.externalTicketUrl}
				class="link text-sm"
				target="_blank"
				rel="noopener noreferrer external"
			>
				Tickets ↗
			</a>
		{/if}

		{#if detail.lineup.length > 0}
			<div class="mt-4 border-t border-base-200 pt-4">
				<p class="mb-2 text-muted font-medium">On the bill</p>
				<ul class="space-y-1">
					{#each detail.lineup as act (act.id)}
						<li class="flex flex-wrap items-center gap-2 text-sm">
							<span class="font-medium">{act.name}</span>
							<!-- `unlinked` is a plain credit; anything else is a claim on a
							     band's profile, so the status is worth showing. -->
							{#if act.status !== 'unlinked'}
								<StatusBadge status={act.status} />
							{/if}
							{#if act.note}<span class="text-muted">{act.note}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if evt.description}
			<div class="mt-4 border-t border-base-200 pt-4">
				<p class="whitespace-pre-wrap">{evt.description}</p>
			</div>
		{/if}

		{#if parseTags(evt.tags).length > 0}
			<div class="mt-4 flex flex-wrap gap-1 pt-4 rule-top">
				{#each parseTags(evt.tags) as tag (tag)}
					<Badge variant="outline">{tag}</Badge>
				{/each}
			</div>
		{/if}
	</InfoCard>

	<!--
		Two people posting one gig is the characteristic failure of a community
		calendar, and moderation is the only backstop — so the moderator has to be
		able to see the slot. An empty result says so out loud rather than
		rendering nothing, which reads as "this page doesn't check".
	-->
	<InfoCard title="Within two hours">
		{#if data.nearby.length === 0}
			<p class="text-muted">Nothing else within two hours of this show.</p>
		{:else}
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Event</th>
					<th class="col-support">Posted by</th>
				{/snippet}
				{#each data.nearby as n (n.id)}
					{@const href = resolve(`/staff/events/${n.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px"><StatusBadge status={n.status} /></td>
						<td class="cell-primary">
							<EntityIdentity ref={n.ref}>
								{#snippet subtitle()}
									<span class="whitespace-nowrap">
										{formatEventTimeRange(n.startsAt, n.endsAt)}
									</span>
								{/snippet}
							</EntityIdentity>
						</td>
						<td class="col-support">
							{#if n.source === 'cmc'}
								<span class="text-muted">CMC</span>
							{:else if n.source === 'band'}
								<EntityChip ref={n.band} />
							{:else}
								<span class="text-muted">Community</span>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>
</PageContent>
