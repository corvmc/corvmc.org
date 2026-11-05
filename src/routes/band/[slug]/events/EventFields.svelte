<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteFormField } from '$app/server';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import LineupEditor, { type LineupChip } from '#lib/components/events/LineupEditor.svelte';
	import { searchBandsForLineup } from '#lib/remote/band-events.remote.js';
	import {
		formatDate,
		formatDollars,
		formatTime,
		toLocalDate,
		toLocalTime
	} from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { priceDisplay } from '#lib/utils/event-ticketing.js';
	import { imageSrc } from '#lib/utils/images.js';

	/**
	 * Every field of a band event, in one place.
	 *
	 * The set used to be written twice — once on the create page and once in the
	 * edit form hidden behind a toggle on the detail page — and the two had
	 * already drifted: create offered `tags` and edit did not, so a band could
	 * never correct a tag after the fact.
	 *
	 * `readonly` renders the same markup without the means to change it, rather
	 * than switching to a different read-only template. That is what lets the
	 * detail page *be* the edit form for anyone who can edit, and stay a legible
	 * detail page for everyone else, with no second layout to keep in step.
	 *
	 * This script must stay synchronous — no top-level `await`. `fields` arrives
	 * as a resolved prop for that reason: a declaration after a top-level await is
	 * async-gated, which would compile every `fields.X.as()` below into an async
	 * derived. Pinned by `src/async-effect-shape.spec.ts`.
	 */
	type EventForDisplay = {
		title: string;
		description: string | null;
		startsAt: Date;
		endsAt: Date | null;
		doorsAt: Date | null;
		location: string | null;
		address: string | null;
		tags: string | null;
		externalTicketUrl: string | null;
		ticketPrice: number | null;
		posterUrl: string | null;
	};

	let {
		fields,
		evt,
		slug,
		bandId,
		lineup = $bindable<LineupChip[]>([]),
		readonly = false
	}: {
		/**
		 * The subset of `remote.fields` this set posts into. Named rather than
		 * `any`: create and update are different form objects, but they overlap
		 * on exactly these fields, so listing them is both accurate and checked —
		 * a form missing one is now a build error here rather than an `undefined`
		 * spread onto an input.
		 */
		fields: {
			title: RemoteFormField<string>;
			description: RemoteFormField<string>;
			eventDate: RemoteFormField<string>;
			eventStartTime: RemoteFormField<string>;
			eventEndTime: RemoteFormField<string>;
			doorsTime: RemoteFormField<string>;
			location: RemoteFormField<string>;
			address: RemoteFormField<string>;
			tags: RemoteFormField<string>;
			posterFile: RemoteFormField<File>;
			externalTicketUrl: RemoteFormField<string>;
			ticketPriceDollars: RemoteFormField<string>;
			lineup: RemoteFormField<string>;
		};
		/** The saved event. Absent when creating. */
		evt?: EventForDisplay;
		/** The band's address, which the lineup lookup guards on. */
		slug: string;
		bandId: string;
		lineup?: LineupChip[];
		readonly?: boolean;
	} = $props();

	const poster = $derived(evt?.posterUrl ? imageSrc(evt.posterUrl, 'thumb') : null);
</script>

<FormField
	field={fields.title}
	type="text"
	label={readonly ? m.band_title() : m.band_slug_events_event_fields_title()}
	value={evt?.title ?? ''}
	placeholder={m.band_e_g_live_at_venue()}
	maxlength="200"
	{readonly}
	display={evt?.title}
/>

<!-- Custom input mode: FormField's built-in textarea drops `rest`, so rows,
     maxlength and placeholder would be lost.
     `readonly` now wins over this child rather than being ignored by it. -->
<FormField
	field={fields.description}
	label={m.band_slug_events_event_fields_description()}
	{readonly}
	display={evt?.description ?? '—'}
>
	<textarea
		{...fields.description.as('text', evt?.description ?? '')}
		class="textarea w-full"
		rows="4"
		maxlength="5000"
		placeholder={m.band_slug_events_event_fields_tell_people_what_expect()}></textarea>
</FormField>

{#if readonly}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<FormField label={m.band_date()} readonly display={evt ? formatDate(evt.startsAt) : ''} />
		<FormField
			label={m.band_slug_events_event_fields_time()}
			readonly
			display={evt ? formatEventTimeRange(evt.startsAt, evt.endsAt) : ''}
		/>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<FormField
			field={fields.eventDate}
			type="date"
			label={m.band_date()}
			value={evt ? toLocalDate(evt.startsAt) : ''}
			required
		/>
		<FormField
			field={fields.eventStartTime}
			type="time"
			label={m.band_start_time()}
			value={evt ? toLocalTime(evt.startsAt) : ''}
			required
		/>
		<FormField
			field={fields.eventEndTime}
			type="time"
			label={m.band_slug_events_event_fields_end_time()}
			value={evt?.endsAt ? toLocalTime(evt.endsAt) : ''}
			description={m.band_slug_events_event_fields_optional_clear_if_don_t()}
		/>
	</div>
{/if}

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
	<!-- Hidden entirely when read-only and unset: a row of em dashes is noise. -->
	{#if !readonly || evt?.doorsAt}
		<FormField
			field={fields.doorsTime}
			type="time"
			label={m.band_slug_events_event_fields_doors_open()}
			value={evt?.doorsAt ? toLocalTime(evt.doorsAt) : ''}
			{readonly}
			display={evt?.doorsAt ? formatTime(evt.doorsAt) : undefined}
		/>
	{/if}
	{#if !readonly || evt?.location}
		<FormField
			field={fields.location}
			type="text"
			label={m.band_venue()}
			value={evt?.location ?? ''}
			maxlength="500"
			{readonly}
			display={evt?.location ?? undefined}
		/>
	{/if}
	{#if !readonly || evt?.address}
		<FormField
			field={fields.address}
			type="text"
			label={m.band_slug_events_event_fields_address()}
			value={evt?.address ?? ''}
			maxlength="500"
			{readonly}
			display={evt?.address ?? undefined}
		/>
	{/if}
</div>

<!-- New on the edit side. `updateBandEventForm` has always accepted `tags` and
     the handler has always written it; only the input was missing, so a typo'd
     tag was permanent. -->
{#if !readonly || evt?.tags}
	<FormField
		field={fields.tags}
		type="text"
		label={m.band_slug_events_event_fields_tags()}
		value={evt?.tags ?? ''}
		placeholder={m.band_slug_events_event_fields_comma_separated_tags()}
		maxlength="500"
		{readonly}
		display={evt?.tags ?? undefined}
	/>
{/if}

<FormField field={fields.lineup} label={m.band_slug_events_event_fields_who_s_playing()}>
	<LineupEditor
		field={fields.lineup}
		bind:value={lineup}
		ownerBandId={bandId}
		{readonly}
		search={(q) => searchBandsForLineup({ slug, q })}
	/>
</FormField>

<!--
	Same treatment as the band avatar — a preview you can see and a Replace
	button — rather than the bare `file-input` this used to be, which read as a
	setting you could skip and is why posters went unadded.

	Still submits with the form, unlike the avatar's immediate POST: an event's
	poster is picked before the event exists, so uploading it up front is how you
	end up with orphaned posters when the create fails. `FileUpload`'s deferred
	mode gives the same chrome without the eager write.
-->
{#if !readonly}
	<FormField
		field={fields.posterFile}
		type="file"
		label={m.band_slug_events_event_fields_poster()}
		accept="image/jpeg,image/png,image/webp"
		src={poster?.src}
		previewClass="h-40 w-32"
		emptyLabel={m.band_slug_events_event_fields_empty_label()}
		replaceLabel={m.band_slug_events_event_fields_replace_label()}
		description={m.band_slug_events_event_fields_shown_events_list_band_s()}
	/>
{:else if poster}
	<FormField label={m.band_slug_events_event_fields_poster()} readonly>
		{#snippet display()}
			<img
				src={poster.src}
				srcset={poster.srcset}
				alt={m.band_slug_events_event_fields_alt()}
				class="h-40 w-32 rounded object-cover"
			/>
		{/snippet}
	</FormField>
{/if}

<div class="grid gap-4 md:grid-cols-2">
	{#if !readonly || evt?.externalTicketUrl}
		<FormField
			field={fields.externalTicketUrl}
			type="text"
			label={m.band_slug_events_event_fields_ticket_link()}
			value={evt?.externalTicketUrl ?? ''}
			placeholder={m.band_slug_events_event_fields_https_eventbrite_com()}
			{readonly}
		>
			{#snippet display()}
				{#if evt?.externalTicketUrl}
					<a
						href={evt.externalTicketUrl}
						target="_blank"
						rel="noopener external"
						class="link break-all link-primary"
					>
						{evt.externalTicketUrl}
					</a>
				{/if}
			{/snippet}
		</FormField>
	{/if}

	<!-- `type="text"` with a decimal inputmode, not `type="number"`: a number
	     FormField registers as `n:` and SvelteKit would hand the handler a
	     number, which `ticketPriceDollars: z.string()` rejects outright. -->
	<FormField
		field={fields.ticketPriceDollars}
		type="text"
		label={m.band_slug_events_event_fields_ticket_price()}
		value={evt?.ticketPrice ? formatDollars(evt.ticketPrice) : ''}
		placeholder="10.00"
		inputmode="decimal"
		description={m.band_slug_events_event_fields_what_people_pay_at_door()}
		{readonly}
		display={evt ? priceDisplay({ ...evt, ticketingEnabled: false }).label : undefined}
	/>
</div>
