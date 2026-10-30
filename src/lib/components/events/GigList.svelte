<script lang="ts">
	import { resolve } from '$app/paths';
	import { IconCheck, IconMapPin } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		toLocalDate,
		formatShortMonth,
		formatDayNumber,
		formatDayOfWeek,
		formatDate,
		formatTime
	} from '$lib/utils/format';
	import { priceDisplay, ticketingMode } from '$lib/utils/event-ticketing';
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc } from '$lib/utils/images';
	import { groupGigs } from '$lib/utils/gig-groups';
	import type { CalendarEntry } from '$lib/types/calendar';

	let {
		events,
		eventBase = '/events',
		rsvpEventIds = []
	}: {
		events: CalendarEntry[];
		/**
		 * Which event route the rows link into. A route id rather than a base
		 * path so the link is built with `resolve()` and checked — a base string
		 * concatenated with an id is unverifiable and was the reason these links
		 * could not satisfy `no-navigation-without-resolve`.
		 */
		eventBase?: '/events' | '/member/events';
		/** Events the viewer has RSVP'd to: those rows say so instead of offering it. */
		rsvpEventIds?: string[];
	} = $props();

	const now = new Date();
	const today = toLocalDate(new Date());
	const sections = $derived(groupGigs(events, today));
	const going = $derived(new Set(rsvpEventIds));

	/** Ids of the first event of each calendar day, for ?from scroll anchors. */
	const firstOfDay = $derived.by(() => {
		const seenDays: Record<string, true> = {};
		const ids: Record<string, true> = {};
		for (const evt of events) {
			const key = toLocalDate(evt.startsAt);
			if (!seenDays[key]) {
				seenDays[key] = true;
				ids[evt.id] = true;
			}
		}
		return ids;
	});
</script>

<div class="gig-list">
	{#each sections as [label, rows] (label)}
		<section class="gig-list__section">
			<h3 class="gig-list__section-head">{label}</h3>
			<ul class="gig-list__rows">
				{#each rows as evt (evt.id)}
					{@const href =
						eventBase === '/member/events'
							? resolve(`/member/events/${evt.id}`)
							: resolve(`/events/${evt.id}`)}
					{@const isCancelled = evt.status === 'cancelled'}
					{@const isOpen = evt.startsAt >= now && !isCancelled}
					{@const mode = ticketingMode(evt)}
					{@const place = evt.venueName ?? evt.location}
					<li
						class="gig-row"
						class:gig-row--cancelled={isCancelled}
						id={firstOfDay[evt.id] ? `day-${toLocalDate(evt.startsAt)}` : undefined}
					>
						<div class="gig-row__date" aria-hidden="true">
							<span class="gig-row__month">{formatShortMonth(evt.startsAt)}</span>
							<span class="gig-row__daynum">{formatDayNumber(evt.startsAt)}</span>
							<span class="gig-row__weekday">{formatDayOfWeek(evt.startsAt)}</span>
						</div>
						<a {href} class="gig-row__thumb" aria-hidden="true" tabindex="-1">
							{#if evt.posterUrl}
								{@const thumb = imageSrc(evt.posterUrl, 'thumb')}
								<img
									src={thumb.src}
									srcset={thumb.srcset}
									sizes={thumb.sizes}
									alt=""
									loading="lazy"
								/>
							{:else}
								<div class="poster-gen poster-gen--{hashPattern(evt.title)}"></div>
							{/if}
						</a>
						<div class="gig-row__body">
							<div class="gig-row__info">
								<span class="gig-row__head">
									<a {href} class="gig-row__title">{evt.title}</a>
									{#if evt.source === 'community'}
										<span class="sticker-badge sticker-badge--sm sticker-badge--green"
											>Community</span
										>
									{:else if evt.source !== 'band'}
										<span class="sticker-badge sticker-badge--sm sticker-badge--orange">CMC</span>
									{/if}
									{#if isCancelled}
										<!-- The cancellation IS the announcement, so mark it plainly
										     rather than greying the row into something people skim. -->
										<span class="gig-row__cancelled-tag">Cancelled</span>
									{/if}
								</span>
								<span class="gig-row__meta">
									{#if place}
										<span class="gig-row__venue">
											<IconMapPin size={13} />
											{place}
										</span>
										·
									{/if}
									<time datetime={evt.startsAt.toISOString()}>
										{formatDate(evt.startsAt)} · {formatTime(evt.startsAt)}
									</time>
								</span>
							</div>
							<!-- Price and its action as one group at the row's end, so the
							     price sits at the same x on every row (#1059). -->
							{#if isOpen}
								<div class="gig-row__buy">
									{#if mode !== 'external' || evt.ticketPrice}
										<span class="gig-row__price">{priceDisplay(evt).label}</span>
									{/if}
									{#if mode === 'external' && evt.externalTicketUrl}
										<Button
											href={evt.externalTicketUrl}
											target="_blank"
											rel="external noopener noreferrer"
											size="sm">Get tickets</Button
										>
									{:else if mode === 'platform'}
										<Button
											href={eventBase === '/member/events'
												? href
												: resolve(`/events/${evt.id}/tickets`)}
											size="sm">Get tickets</Button
										>
									{:else if going.has(evt.id)}
										<span class="gig-row__going"><IconCheck size={14} /> Going</span>
									{:else}
										<Button {href} size="sm">RSVP</Button>
									{/if}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.gig-list {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}

	.gig-list__section-head {
		font-size: 0.95rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--cmc-navy);
		border-bottom: 1px solid var(--surface-border);
		padding-bottom: 0.35rem;
		margin-bottom: 0.75rem;
	}

	.gig-list__rows {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.gig-row {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		scroll-margin-top: 5rem;
	}

	.gig-row__date {
		flex-shrink: 0;
		width: 3rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1.15;
	}

	.gig-row__month {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--cmc-orange);
	}

	.gig-row__daynum {
		font-size: 1.35rem;
		font-weight: 800;
		color: var(--cmc-navy);
	}

	.gig-row__weekday {
		font-size: 10px;
		font-weight: 600;
		opacity: 0.6;
	}

	.gig-row__thumb {
		flex-shrink: 0;
		width: 64px;
		height: 84px;
		border: 2px solid var(--surface-border);
		border-radius: 4px;
		overflow: hidden;
		background: var(--surface);
		transform: rotate(-1deg);
		box-shadow: 1.5px 1.5px 0 rgba(0, 0, 0, 0.15);
	}

	.gig-row:nth-child(even) .gig-row__thumb {
		transform: rotate(1deg);
	}

	.gig-row__thumb img,
	.gig-row__thumb .poster-gen {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Wraps the price group under the text once the row is too narrow for both. */
	.gig-row__body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	.gig-row__info {
		flex: 1 1 12rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	/* Struck date, not a faded row — a cancelled show has to stay legible. */
	.gig-row--cancelled .gig-row__daynum,
	.gig-row--cancelled .gig-row__month,
	.gig-row--cancelled .gig-row__weekday {
		text-decoration: line-through;
		opacity: 0.7;
	}
	.gig-row--cancelled .gig-row__thumb {
		opacity: 0.55;
	}
	.gig-row__head .sticker-badge {
		margin-left: 0.4rem;
	}
	.gig-row__cancelled-tag {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 1px 6px;
		border: 1px solid currentColor;
		border-radius: 3px;
		font-size: 10px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--cmc-red-orange);
		vertical-align: middle;
	}

	.gig-row__head {
		font-size: 1.05rem;
		line-height: 1.25;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.gig-row__title {
		font-weight: 700;
		color: var(--cmc-navy);
	}

	.gig-row__title:hover {
		text-decoration: underline;
	}

	/* `margin-left: auto` rather than a fixed width: the right edge is what the
	   eye compares along. */
	.gig-row__buy {
		margin-left: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.gig-row__price {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--fg-2);
	}

	.gig-row__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
		font-size: 0.8rem;
		color: var(--fg-2);
	}

	.gig-row__venue,
	.gig-row__going {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.gig-row__going {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--cmc-teal);
	}
</style>
