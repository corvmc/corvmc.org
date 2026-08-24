<script lang="ts">
	import { formatDate, formatTime } from '$lib/utils/format';
	import { priceDisplay } from '$lib/utils/event-ticketing';
	import { hashPattern, darkTextPatterns } from '$lib/utils/patterns';
	import { imageSrc } from '$lib/utils/images';

	interface Props {
		href: string;
		title: string;
		posterUrl?: string | null;
		startsAt: Date;
		ticketingEnabled?: boolean;
		ticketPrice?: number | null;
		/** Set when somebody else sells the tickets — keeps the card off "Free". */
		externalTicketUrl?: string | null;
		tags?: string | null;
		tapeLabel?: string;
		tapeColor?: 'orange' | 'teal' | 'red' | 'navy' | '';
		hasTicket?: boolean;
		isFree?: boolean;
		isPast?: boolean;
		isSoldOut?: boolean;
		isStatic?: boolean;
		class?: string;
	}

	let {
		href,
		title,
		posterUrl,
		startsAt,
		ticketingEnabled = false,
		ticketPrice,
		externalTicketUrl,
		tags,
		tapeLabel,
		tapeColor = '',
		hasTicket = false,
		isFree = false,
		isPast = false,
		isSoldOut = false,
		isStatic = false,
		class: className = ''
	}: Props = $props();

	function parseTags(raw: string | null | undefined): string[] {
		if (!raw) return [];
		return raw
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
	}

	const tagList = $derived(parseTags(tags));

	const poster = $derived(imageSrc(posterUrl, 'poster'));

	// `isFree` is an explicit override (member ticket lists); otherwise the price
	// comes from the event's own ticketing fields.
	const price = $derived(
		priceDisplay({ ticketingEnabled, ticketPrice: ticketPrice ?? null, externalTicketUrl })
	);

	const pattern = $derived(hashPattern(title));
	const patternClass = $derived(`poster-gen--${pattern}`);
	const needsDarkText = $derived(darkTextPatterns.has(pattern));

	const stateClasses = $derived(
		[isPast && 'polaroid--past', isSoldOut && 'polaroid--soldout', isStatic && 'polaroid--static']
			.filter(Boolean)
			.join(' ')
	);
</script>

{#if isStatic}
	<div class="poster-card {stateClasses} {className}">
		{#if tapeLabel}
			<span class="polaroid__tape {tapeColor ? `polaroid__tape--${tapeColor}` : ''}"
				>{tapeLabel}</span
			>
		{/if}
		<figure class="poster-card__figure">
			{#if posterUrl}
				<img src={poster.src} srcset={poster.srcset} sizes={poster.sizes} alt={title} />
			{:else}
				<div class="poster-gen {patternClass}">
					<span class="poster-gen__eyebrow">{formatDate(startsAt)}</span>
					<span class="poster-gen__title {needsDarkText ? 'poster-gen__title--dark' : ''}"
						>{title}</span
					>
					<span class="poster-gen__spacer"></span>
					<span class="poster-gen__date {needsDarkText ? 'poster-gen__date--dark' : ''}"
						>{formatTime(startsAt)}</span
					>
				</div>
			{/if}
		</figure>
		<div class="poster-card__caption">
			<div class="poster-card__title">{title}</div>
			<div class="poster-card__date">
				{formatDate(startsAt)} · {formatTime(startsAt)}
			</div>
			{@render priceLine()}
			{@render tagBadges()}
		</div>
	</div>
{:else}
	<a {href} class="poster-card {stateClasses} {className}">
		{#if tapeLabel}
			<span class="polaroid__tape {tapeColor ? `polaroid__tape--${tapeColor}` : ''}"
				>{tapeLabel}</span
			>
		{/if}
		<figure class="poster-card__figure">
			{#if posterUrl}
				<img src={poster.src} srcset={poster.srcset} sizes={poster.sizes} alt={title} />
			{:else}
				<div class="poster-gen {patternClass}">
					<span class="poster-gen__eyebrow">{formatDate(startsAt)}</span>
					<span class="poster-gen__title {needsDarkText ? 'poster-gen__title--dark' : ''}"
						>{title}</span
					>
					<span class="poster-gen__spacer"></span>
					<span class="poster-gen__date {needsDarkText ? 'poster-gen__date--dark' : ''}"
						>{formatTime(startsAt)}</span
					>
				</div>
			{/if}
		</figure>
		<div class="poster-card__caption">
			<div class="poster-card__title">{title}</div>
			<div class="poster-card__date">
				{formatDate(startsAt)} · {formatTime(startsAt)}
			</div>
			{@render priceLine()}
			{@render tagBadges()}
		</div>
	</a>
{/if}

{#snippet priceLine()}
	{#if hasTicket}
		<div class="poster-card__price poster-card__price--ticketed">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				style="width:14px;height:14px"
				><path
					d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"
				/><path d="M13 6v12" /></svg
			>
			Ticketed
		</div>
	{:else if isFree}
		<div class="poster-card__price poster-card__price--free">Free</div>
	{:else}
		<div class="poster-card__price {price.label === 'Free' ? 'poster-card__price--free' : ''}">
			{price.label}
		</div>
	{/if}
{/snippet}

{#snippet tagBadges()}
	{#if tagList.length > 0 && !tapeLabel}
		<div class="poster-card__tags">
			{#each tagList as tag (tag)}
				<span class="sticker-badge sticker-badge--sm">{tag}</span>
			{/each}
		</div>
	{/if}
{/snippet}

<style>
	.poster-card {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 10px 10px 14px;
		border: 2.5px solid var(--cmc-brown);
		border-radius: 8px;
		background: var(--bg-card);
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		transform: rotate(var(--tilt, 0deg));
		transition:
			transform 180ms ease,
			box-shadow 180ms ease;
		isolation: isolate;
	}
	.poster-card:hover {
		transform: rotate(0deg) translateY(-3px);
		box-shadow: 0 6px 0 var(--cmc-brown);
		z-index: 2;
	}
	.poster-card:active {
		transform: rotate(0deg) translateY(2px);
		box-shadow: 0 2px 0 var(--cmc-brown);
	}
	.poster-card:nth-child(3n + 1) {
		--tilt: -1deg;
	}
	.poster-card:nth-child(3n + 2) {
		--tilt: 1.4deg;
	}
	.poster-card:nth-child(3n + 3) {
		--tilt: -0.6deg;
	}
	.poster-card:nth-child(5n) {
		--tilt: 1deg;
	}
	.poster-card:nth-child(7n) {
		--tilt: -1.5deg;
	}

	.poster-card:global(.polaroid--static),
	.poster-card:global(.polaroid--static):hover,
	.poster-card:global(.polaroid--static):active {
		box-shadow: none;
		transform: none;
		cursor: default;
	}

	.poster-card__figure {
		/* US Letter (8.5 x 11) portrait — standard show-poster proportions */
		aspect-ratio: 8.5 / 11;
		background: color-mix(in oklch, var(--cmc-light-blue) 60%, transparent);
		border: 2px solid var(--cmc-brown);
		border-radius: 4px;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.poster-card__figure img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.poster-card__caption {
		padding: 10px 6px 0;
		text-align: center;
	}
	.poster-card__title {
		font-weight: 700;
		font-size: 15px;
		line-height: 1.15;
		color: var(--color-secondary);
		letter-spacing: -0.005em;
		text-wrap: balance;
	}
	.poster-card__date {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--fg-2);
		margin-top: 6px;
		font-feature-settings: 'tnum';
		line-height: 1.35;
	}

	.poster-card__price {
		margin-top: 3px;
		text-transform: uppercase;
		color: var(--cmc-orange);
		font-weight: 700;
		font-size: 11.5px;
		letter-spacing: 0.04em;
	}
	.poster-card__tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px;
		margin-top: 6px;
	}

	.poster-card__price--free {
		color: var(--cmc-teal);
	}
	.poster-card__price--ticketed {
		color: var(--cmc-green);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}
</style>
