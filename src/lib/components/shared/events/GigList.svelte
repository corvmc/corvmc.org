<script lang="ts">
	import { IconMapPin, IconTicket } from '@tabler/icons-svelte';
	import {
		toLocalDate,
		formatShortMonth,
		formatDayNumber,
		formatDayOfWeek,
		formatTime
	} from '$lib/utils/format';
	import { priceDisplay } from '$lib/utils/event-ticketing';
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc } from '$lib/utils/images';
	import { groupGigs } from '$lib/utils/gig-groups';
	import type { CalendarEntry } from '$lib/types/calendar';

	let {
		events,
		eventBase = '/events',
		bandBase = '/directory/bands',
		showByline = true
	}: {
		events: CalendarEntry[];
		/** Base path for event links — member routes pass '/member/events'. */
		eventBase?: string;
		/** Base path for the byline band link. */
		bandBase?: string;
		/** Off on a band's own profile, where every row is that band. */
		showByline?: boolean;
	} = $props();

	const now = new Date();
	const today = toLocalDate(new Date());
	const sections = $derived(groupGigs(events, today));

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
					{@const href = `${eventBase}/${evt.id}`}
					{@const isPast = evt.startsAt < now}
					{@const isCancelled = evt.status === 'cancelled'}
					<li
						class="gig-row"
						class:gig-row--cancelled={isCancelled}
						id={firstOfDay[evt.id] ? `day-${toLocalDate(evt.startsAt)}` : undefined}
					>
						<div class="gig-row__date">
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
						<div class="gig-row__info">
							<a {href} class="gig-row__title">{evt.title}</a>
							{#if isCancelled}
								<!-- The row exists to be read: the cancellation IS the
								     announcement, so mark it plainly rather than greying it
								     down into something people skim past. -->
								<span class="gig-row__cancelled-tag">Cancelled</span>
							{/if}
							{#if showByline}
								<span class="gig-row__byline">
									{#if evt.source === 'band' && evt.bandName}
										by
										{#if evt.bandSlug}
											<a href="{bandBase}/{evt.bandSlug}" class="gig-row__band">{evt.bandName}</a>
										{:else}
											{evt.bandName}
										{/if}
									{:else if evt.source === 'community'}
										<span class="sticker-badge sticker-badge--sm sticker-badge--green"
											>Community</span
										>
									{:else}
										<span class="sticker-badge sticker-badge--sm sticker-badge--orange">CMC</span>
									{/if}
								</span>
							{/if}
							<span class="gig-row__meta">
								{#if evt.location}
									<span class="gig-row__venue">
										<IconMapPin size={13} />
										{evt.location}
									</span>
									·
								{/if}
								{formatTime(evt.startsAt)}
								<!-- The price reads the same whoever sells it; the link is extra.
								     Skipped only when an off-site seller sets a price we don't know. -->
								{#if !evt.externalTicketUrl || evt.ticketPrice}
									· {priceDisplay(evt).label}
								{/if}
								{#if evt.externalTicketUrl && !isPast && !isCancelled}
									·
									<a
										href={evt.externalTicketUrl}
										class="gig-row__tickets"
										target="_blank"
										rel="noopener noreferrer"
									>
										<IconTicket size={13} />
										Tickets
									</a>
								{/if}
							</span>
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

	.gig-row__info {
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

	.gig-row__title {
		font-weight: 700;
		font-size: 1.05rem;
		line-height: 1.25;
		color: var(--cmc-navy);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.gig-row__title:hover {
		text-decoration: underline;
	}

	.gig-row__byline {
		font-size: 0.85rem;
		color: var(--fg-2);
	}

	.gig-row__band {
		font-weight: 600;
		color: var(--cmc-teal);
	}

	.gig-row__band:hover {
		text-decoration: underline;
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
	.gig-row__tickets {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.gig-row__tickets {
		font-weight: 600;
	}

	.gig-row__tickets:hover {
		text-decoration: underline;
	}
</style>
