<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { page } from '$app/state';
	import { goToCheckout } from '#lib/utils/checkout-navigation.js';
	import { resolve } from '$app/paths';
	import { IconCalendarPlus } from '@tabler/icons-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import PosterCard from '#lib/components/events/PosterCard.svelte';
	import EventFacts from '#lib/components/events/EventFacts.svelte';
	import TicketStub from '#lib/components/events/TicketStub.svelte';
	import TicketQRModal from '#lib/components/events/TicketQRModal.svelte';
	import TicketPurchaseFields from '#lib/components/events/TicketPurchaseFields.svelte';
	import { formatCents } from '#lib/utils/format.js';
	import { ticketingMode, isFreeEvent as isFree } from '#lib/utils/event-ticketing.js';
	import { sanitizeHtml } from '#lib/utils/markdown.js';
	import { tagToTapeVariant, tagToStickerColor } from '#lib/utils/tag-colors.js';
	import { googleCalendarUrl, icsDataUrl } from '#lib/utils/calendar.js';
	import { placeLine } from '#lib/utils/place.js';
	import ShareButton from '#lib/components/ui/ShareButton.svelte';
	import {
		purchaseTickets,
		claimFreeTicket,
		rsvpToEvent,
		cancelRsvp,
		getMemberEventDetailPage
	} from '#lib/remote/events.remote.js';

	const { fields } = purchaseTickets;
	const rsvpFields = claimFreeTicket.fields;
	const rsvpToEventFields = rsvpToEvent.fields;
	const cancelRsvpFields = cancelRsvp.fields;

	const detail = $derived(await getMemberEventDetailPage(page.params.id!));
	const eventData = $derived(detail.event);
	const allTickets = $derived(detail.tickets);
	let myTickets = $derived(
		allTickets.filter((t) => t.eventId === page.params.id && t.status !== 'cancelled')
	);
	let myTicket = $derived(myTickets[0] ?? null);
	let data = $derived({ ...eventData, myTicket });

	const evt = $derived(data.event);
	// Descriptions are rich text (legacy rows contain HTML), so sanitize before
	// rendering to strip any XSS payload while keeping formatting.
	const descriptionHtml = $derived(evt.description ? sanitizeHtml(evt.description) : '');
	const mode = $derived(ticketingMode(evt));
	const isFreeEvent = $derived(isFree(evt));
	const soldOut = $derived(data.remaining === 0);
	const maxQuantity = $derived(data.remaining !== null ? Math.min(data.remaining, 10) : 10);

	// Read back out of TicketPurchaseFields: only it knows what the card will be
	// charged, and the Action modal's own button needs both the number and
	// whether the amount is one the remote will refuse.
	let chargeCents = $state(0);
	let amountBlocked = $state(false);

	// Availability visuals (ticketed, capacity-capped events only)
	const capacityKnown = $derived(
		evt.ticketingEnabled && evt.ticketQuantity != null && data.sold != null
	);
	const lowAvailability = $derived(
		evt.ticketingEnabled &&
			data.remaining !== null &&
			!soldOut &&
			(data.remaining <= 10 ||
				(evt.ticketQuantity ? data.remaining / evt.ticketQuantity <= 0.15 : false))
	);

	const quantityOptions = $derived(
		Array.from({ length: maxQuantity }, (_, i) => ({ value: i + 1, label: String(i + 1) }))
	);

	const calendarEvt = $derived({
		id: evt.id,
		title: evt.title,
		description: evt.description,
		location: placeLine(evt),
		startsAt: evt.startsAt,
		endsAt: evt.endsAt
	});

	let quantity = $state(1);
	// Deliberately the initial value only: these are editable form defaults, so
	// re-reading `detail` would overwrite whatever the buyer had typed.
	let attendeeName = $state(untrack(() => detail.viewer.name ?? ''));
	let attendeeEmail = $state(untrack(() => detail.viewer.email ?? ''));
	let qrOpen = $state(false);
	let qrIndex = $state(0);

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	const tagList = $derived(parseTags(evt.tags));
	const primaryTag = $derived(tagList[0] ?? null);
	// The poster's tape already shows the primary tag.
	const stickerTags = $derived(tagList.filter((tag) => tag !== primaryTag));

	function refreshDetail() {
		// The wrapper this page reads, not the two it is assembled from.
		void getMemberEventDetailPage(page.params.id!).refresh();
	}

	async function handlePurchaseSuccess(result?: unknown) {
		const data = result as { redirectUrl?: string } | undefined;
		if (data?.redirectUrl) await goToCheckout(data.redirectUrl);
	}
</script>

<PageHeader title={evt.title}>
	<div class="flex items-center gap-1">
		<details class="dropdown dropdown-end">
			<summary class="btn gap-1 btn-ghost btn-sm">
				<IconCalendarPlus size={18} />
				{m.member_events_id_add_calendar()}
			</summary>
			<ul class="menu dropdown-content dropdown-panel w-48">
				<li>
					<a
						href={googleCalendarUrl(calendarEvt)}
						target="_blank"
						rel="external noopener noreferrer">{m.member_events_id_google_calendar()}</a
					>
				</li>
				<li>
					<a href={icsDataUrl(calendarEvt)} rel="external" download="{evt.title}.ics"
						>{m.member_events_id_apple_outlook_ics()}</a
					>
				</li>
			</ul>
		</details>
		<ShareButton title={m.member_events_id_title()} />
	</div>
</PageHeader>
<PageContent>
	{#if myTickets.length > 0}
		<section>
			<SectionLabel
				label={myTickets.length === 1 ? m.member_events_id_ticket() : m.member_events_id_tickets()}
				count={myTickets.length}
			/>
			<div class="edet__stubs">
				{#each myTickets as t, i (t.id)}
					<TicketStub
						ticket={t}
						tags={evt.tags}
						onclick={() => {
							qrIndex = i;
							qrOpen = true;
						}}
					/>
				{/each}
			</div>
		</section>
		<TicketQRModal bind:open={qrOpen} tickets={myTickets} initialIndex={qrIndex} />
	{/if}

	<div class="edet">
		<div class="edet__poster">
			<PosterCard
				href={resolve(`member/events/${evt.id}`)}
				title={evt.title}
				posterUrl={evt.posterUrl}
				startsAt={evt.startsAt}
				ticketingEnabled={evt.ticketingEnabled}
				ticketPrice={evt.ticketPrice}
				externalTicketUrl={evt.externalTicketUrl}
				tags={evt.tags}
				tapeLabel={primaryTag ?? undefined}
				tapeColor={primaryTag ? tagToTapeVariant(primaryTag) : ''}
				isStatic
				class="w-full"
			/>
		</div>

		<div class="edet__main">
			{#if stickerTags.length > 0}
				<div class="edet__tags">
					{#each stickerTags as tag (tag)}
						<span class="sticker {tagToStickerColor(tag)}">{tag}</span>
					{/each}
				</div>
			{/if}

			<p class="edet__title">{evt.title}</p>

			<EventFacts {evt} />

			{#if descriptionHtml}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized rich text (sanitizeHtml) -->
				<p class="edet__desc">{@html descriptionHtml}</p>
			{/if}

			{#if evt.status === 'cancelled' || data.isPast}
				<!-- The server refuses both; the page must not offer them (#2219). -->
				<div class="edet__ctas">
					<span class="text-base font-medium text-fg-2">
						{evt.status === 'cancelled'
							? m.member_events_id_tickets_rsvps_closed()
							: m.member_events_id_event_has_ended()}
					</span>
				</div>
			{:else if evt.ticketingEnabled}
				{#if capacityKnown}
					<div class="edet__capacity">
						<div class="edet__capacity-head">
							<span
								>{m.member_events_id_claimed({
									sold: data.sold ?? '',
									ticketQuantity: evt.ticketQuantity ?? ''
								})}</span
							>
							{#if lowAvailability}
								<Badge variant="warning"
									>{isFreeEvent
										? m.member_events_id_almost_full()
										: m.member_events_id_selling_fast()}</Badge
								>
							{/if}
						</div>
						<progress
							class="progress w-full progress-primary"
							value={data.sold}
							max={evt.ticketQuantity}
						></progress>
					</div>
				{/if}

				<div class="edet__ctas">
					{#if soldOut}
						<Button variant="default" size="lg" disabled
							>{isFreeEvent ? m.member_events_id_full() : m.member_events_id_sold_out()}</Button
						>
					{:else if !data.myTicket}
						{#if isFreeEvent}
							<Action
								action={claimFreeTicket}
								label={m.member_events_id_get_free_ticket()}
								modalTitle={m.member_events_id_get_free_ticket()}
								submitLabel={m.member_events_id_get({
									value: quantity > 1 ? `${quantity} tickets` : 'ticket'
								})}
								canSubmit={!!attendeeName.trim() && !!attendeeEmail.trim()}
								variant="primary"
								size="lg"
								onsuccess={handlePurchaseSuccess}
							>
								{#snippet form()}
									<input {...rsvpFields.eventId.as('hidden', evt.id)} />

									<Field
										label={m.member_events_id_number_spots()}
										field={claimFreeTicket.fields.quantity}
										type="select"
										options={quantityOptions}
										bind:value={quantity}
									/>

									<Field
										field={claimFreeTicket.fields.attendeeName}
										type="text"
										label={m.member_name()}
										bind:value={attendeeName}
									/>
									<Field
										field={claimFreeTicket.fields.attendeeEmail}
										type="email"
										label={m.member_email()}
										bind:value={attendeeEmail}
									/>
								{/snippet}
							</Action>
						{:else}
							<Action
								action={purchaseTickets}
								label={m.member_events_id_get_tickets()}
								modalTitle={m.member_events_id_get_tickets()}
								submitLabel={chargeCents === 0
									? m.member_events_id_get({
											value: quantity === 1 ? 'ticket' : `${quantity} tickets`
										})
									: m.member_events_id_pay({ formatCents: formatCents(chargeCents) })}
								canSubmit={!!attendeeName.trim() && !!attendeeEmail.trim() && !amountBlocked}
								variant="primary"
								size="lg"
								onsuccess={handlePurchaseSuccess}
							>
								{#snippet form()}
									<input {...fields.eventId.as('hidden', evt.id)} />

									<div class="flex items-baseline gap-2">
										<span class="text-lg font-bold">{formatCents(evt.ticketPrice!)}</span>
										<span class="text-muted">{m.member_events_id_suggested_per_ticket()}</span>
									</div>

									<Field
										label={m.member_events_id_number_tickets()}
										field={purchaseTickets.fields.quantity}
										type="select"
										options={quantityOptions}
										bind:value={quantity}
									/>

									<Field
										field={purchaseTickets.fields.attendeeName}
										type="text"
										label={m.member_name()}
										bind:value={attendeeName}
									/>
									<Field
										field={purchaseTickets.fields.attendeeEmail}
										type="email"
										label={m.member_email()}
										bind:value={attendeeEmail}
									/>
									<TicketPurchaseFields
										suggestedUnitCents={evt.ticketPrice ?? 0}
										floorCents={evt.ticketPriceFloorCents}
										{quantity}
										acts={data.acts}
										collectiveShareBps={data.collectiveShareBps}
										{fields}
										submit={false}
										onstate={(s) => {
											chargeCents = s.chargeCents;
											amountBlocked = s.blocked;
										}}
									/>
								{/snippet}
							</Action>
						{/if}
					{/if}

					{#if data.remaining !== null && !soldOut}
						<span class="text-muted"
							>{(isFreeEvent
								? m.member_events_id_spots_remaining
								: m.member_events_id_tickets_remaining)({ remaining: data.remaining })}</span
						>
					{/if}
				</div>
			{:else}
				<!-- Not sold by us: tickets (if any) come from an off-site seller, and
				     the RSVP is the lightweight join row — no QR, no check-in. -->
				<div class="edet__ctas">
					{#if mode === 'external'}
						<Button
							href={evt.externalTicketUrl!}
							target="_blank"
							rel="noopener noreferrer"
							variant="primary"
							size="lg">{m.member_events_id_get_tickets_2()}</Button
						>
					{/if}
					{#if data.myRsvp}
						<div class="tixbanner tixbanner--static">
							<div class="tixbanner__icon">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									style="width:20px;height:20px"><path d="M5 12l4 4 10-10" /></svg
								>
							</div>
							<div class="tixbanner__text">
								<strong>{m.member_events_id_re_going()}</strong>
								<small>
									{mode === 'external'
										? m.member_events_id_tickets_sold_separately_grab_yours()
										: m.member_events_id_we_ll_see_there()}
								</small>
							</div>
						</div>
						<Action
							action={cancelRsvp}
							label={m.member_events_id_can_t_make()}
							confirm={m.member_events_id_confirm()}
							modalTitle={m.member_events_id_cancel_rsvp()}
							submitLabel={m.member_events_id_yes_cancel_my_rsvp()}
							submitVariant="error"
							variant="ghost"
							size="sm"
							onsuccess={refreshDetail}
						>
							{#snippet form()}
								<input {...cancelRsvpFields.eventId.as('hidden', evt.id)} />
							{/snippet}
						</Action>
					{:else}
						<Action
							action={rsvpToEvent}
							label={mode === 'external'
								? m.member_events_id_i_m_going()
								: m.member_events_id_rsvp()}
							modalTitle={mode === 'external'
								? m.member_events_id_i_m_going()
								: m.member_events_id_rsvp()}
							submitLabel={mode === 'external'
								? m.member_events_id_i_m_going()
								: m.member_events_id_rsvp()}
							canSubmit={!!attendeeName.trim() && !!attendeeEmail.trim()}
							class="btn-lg {mode === 'external' ? 'btn-outline' : 'btn-primary'}"
							onsuccess={refreshDetail}
						>
							{#snippet form()}
								<input {...rsvpToEventFields.eventId.as('hidden', evt.id)} />
								<Field
									field={rsvpToEvent.fields.attendeeName}
									type="text"
									label={m.member_name()}
									bind:value={attendeeName}
								/>
								<Field
									field={rsvpToEvent.fields.attendeeEmail}
									type="email"
									label={m.member_email()}
									bind:value={attendeeEmail}
								/>
							{/snippet}
						</Action>
					{/if}

					{#if data.rsvpCount > 0}
						<span class="text-muted">{m.member_events_id_going({ rsvpCount: data.rsvpCount })}</span
						>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if data.upcoming.length > 0}
		<section class="edet__more">
			<SectionLabel label={m.member_events_id_more_shows()} />
			<div class="edet__more-grid">
				{#each data.upcoming as e (e.id)}
					{@const eTags = parseTags(e.tags)}
					<PosterCard
						href={resolve(`member/events/${e.id}`)}
						title={e.title}
						posterUrl={e.posterUrl}
						startsAt={e.startsAt}
						ticketingEnabled={e.ticketingEnabled}
						ticketPrice={e.ticketPrice}
						externalTicketUrl={e.externalTicketUrl}
						tags={e.tags}
						tapeLabel={eTags[0] ?? undefined}
						tapeColor={eTags[0] ? tagToTapeVariant(eTags[0]) : ''}
					/>
				{/each}
			</div>
		</section>
	{/if}
</PageContent>

<style>
	.edet__stubs {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.edet__capacity {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.edet__capacity-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--fg-2);
	}

	.tixbanner--static {
		cursor: default;
	}

	.edet__upsell {
		font-size: 0.85rem;
		color: var(--fg-2);
	}

	.edet__more {
		margin-top: 2.5rem;
	}

	.edet__more-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.25rem;
	}

	@media (min-width: 768px) {
		.edet__more-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
</style>
