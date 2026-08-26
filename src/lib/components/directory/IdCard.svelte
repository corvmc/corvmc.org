<script lang="ts">
	import speakerLogo from '$lib/assets/cmc-speaker-icon.svg';
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc } from '$lib/utils/images';
	import { IconUserSearch, IconBriefcase, IconSchool, IconUsersPlus } from '@tabler/icons-svelte';
	import { initials } from '$lib/utils/format';

	interface Props {
		href: string;
		name: string;
		image?: string | null;
		pronouns?: string | null;
		tagline?: string | null;
		instruments?: string[];
		genres?: string[];
		bands?: { name: string }[];
		lookingForBand?: boolean;
		availableForHire?: boolean;
		teachesLessons?: boolean;
		openToCollaboration?: boolean;
		memberSince: number;
	}

	let {
		href,
		name,
		image,
		pronouns,
		tagline,
		instruments = [],
		genres = [],
		bands = [],
		lookingForBand = false,
		availableForHire = false,
		teachesLessons = false,
		openToCollaboration = false,
		memberSince
	}: Props = $props();

	const patternClass = $derived(`poster-gen--${hashPattern(name)}`);
	const photo = $derived(imageSrc(image, 'avatar-lg'));

	const MAX_TAGS = 3;
	const shownInstruments = $derived(instruments.slice(0, MAX_TAGS));
	const shownGenres = $derived(genres.slice(0, MAX_TAGS));
	const shownBands = $derived(bands.slice(0, MAX_TAGS));

	const flags = $derived(
		[
			lookingForBand && { icon: IconUserSearch, label: 'Seeking a band' },
			availableForHire && { icon: IconBriefcase, label: 'Available for hire' },
			teachesLessons && { icon: IconSchool, label: 'Teaches lessons' },
			openToCollaboration && { icon: IconUsersPlus, label: 'Open to collaboration' }
		].filter(Boolean) as { icon: typeof IconUserSearch; label: string }[]
	);
</script>

<a {href} class="id-card">
	<div class="id-card__header">
		<div class="id-card__brand">
			<img src={speakerLogo} alt="" class="id-card__logo" />
			<span>Corvallis Music<br />Collective</span>
		</div>
		<div class="id-card__tag">MEMBER</div>
	</div>
	<div class="id-card__body">
		<div class="id-card__photo">
			{#if image}
				<img
					src={photo.src}
					srcset={photo.srcset}
					alt={name}
					class="h-full w-full rounded object-cover"
				/>
			{:else}
				<div class="poster-gen {patternClass} id-card__pattern">
					<span class="id-card__initials">{initials(name)}</span>
				</div>
			{/if}
		</div>
		<div class="id-card__info">
			<div class="id-card__name">
				{name}
				{#if pronouns}
					<span class="id-card__pronouns">{pronouns}</span>
				{/if}
			</div>
			{#if tagline}
				<div class="id-card__role">{tagline}</div>
			{/if}
			{#if instruments.length}
				<div class="id-card__badges">
					{#each shownInstruments as inst (inst)}
						<span class="id-tag id-tag--teal">{inst}</span>
					{/each}
				</div>
			{/if}
			{#if genres.length}
				<div class="id-card__badges">
					{#each shownGenres as genre (genre)}
						<span class="id-tag id-tag--genre">{genre}</span>
					{/each}
				</div>
			{/if}
			{#if bands.length}
				<div class="id-card__bands">
					{#each shownBands as b (b.name)}
						<span class="id-tag id-tag--band">{b.name}</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>
	<div class="id-card__footer">
		<div class="id-card__since">Member since {memberSince}</div>
		{#if flags.length}
			<div class="id-card__flags">
				{#each flags as flag (flag.label)}
					<span class="tooltip" data-tip={flag.label} aria-label={flag.label}>
						<flag.icon class="id-card__flag-icon" />
					</span>
				{/each}
			</div>
		{/if}
	</div>
</a>

<style>
	.id-card {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--bg-card, var(--color-base-200));
		width: 100%;
		max-width: 320px;
		border-radius: 10px;
		border: 2px solid var(--cmc-brown);
		overflow: visible;
		transform: rotate(var(--tilt, -1deg));
		transition:
			transform 220ms cubic-bezier(0.34, 1.4, 0.64, 1),
			box-shadow 220ms ease;
		cursor: pointer;
		padding: 0;
		aspect-ratio: 5 / 3;
		container-type: inline-size;
	}
	.id-card:focus,
	.id-card:hover {
		transform: rotate(0deg) translateY(-3px);
		box-shadow: 0 6px 0 0 var(--cmc-brown);
	}
	.id-card:nth-child(3n + 1) {
		--tilt: -1.2deg;
	}
	.id-card:nth-child(3n + 2) {
		--tilt: 0.8deg;
	}
	.id-card:nth-child(3n + 3) {
		--tilt: -0.3deg;
	}
	.id-card:nth-child(5n) {
		--tilt: 1.6deg;
	}
	.id-card:nth-child(7n) {
		--tilt: -1.8deg;
	}

	.id-card__header {
		padding: 4cqi 5cqi 2.5cqi;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 3cqi;
		position: relative;
	}
	.id-card__brand {
		display: flex;
		align-items: center;
		gap: 1.5cqi;
		font-weight: 700;
		font-size: 3.3cqi;
		letter-spacing: 0.02em;
		color: var(--cmc-teal);
		line-height: 1.1;
		max-width: 65%;
	}
	.id-card__logo {
		height: 8cqi;
		width: auto;
		object-fit: contain;
		flex-shrink: 0;
	}
	.id-card__tag {
		font-weight: 700;
		font-size: 2.8cqi;
		letter-spacing: 0.16em;
		color: var(--cmc-teal);
		line-height: 1;
		padding: 1cqi 2.5cqi;
		border: 1.5px solid var(--cmc-teal);
		border-radius: 3px;
		flex-shrink: 0;
	}
	.id-card__header::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -2cqi;
		height: 2cqi;
		background: linear-gradient(
			to bottom,
			var(--cmc-teal) 0 33.333%,
			var(--cmc-goldenrod) 33.333% 66.666%,
			var(--cmc-red-orange) 66.666% 100%
		);
	}
	.id-card__body {
		flex: 1;
		display: flex;
		gap: 3.5cqi;
		padding: 5cqi 5cqi 4cqi;
		align-items: stretch;
	}
	.id-card__photo {
		width: 17.5cqi;
		align-self: stretch;
		border-radius: 4px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
	}
	.id-card__pattern {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.id-card__initials {
		font-weight: 700;
		font-size: 6cqi;
		color: #fff;
		-webkit-text-stroke: 2px var(--cmc-brown);
		paint-order: stroke fill;
		letter-spacing: 0.02em;
		z-index: 1;
	}
	.id-card__info {
		display: flex;
		flex-direction: column;
		gap: 0.5cqi;
		min-width: 0;
		flex: 1;
	}
	.id-card__name {
		font-weight: 700;
		font-size: 5.8cqi;
		line-height: 1.15;
		color: var(--color-secondary);
	}
	.id-card__pronouns {
		white-space: nowrap;
		font-weight: 400;
		font-size: 3.2cqi;
		color: var(--fg-3);
		margin-left: 0.5cqi;
	}
	.id-card__role {
		font-size: 3.8cqi;
		color: var(--fg-2);
	}
	.id-card__badges {
		display: flex;
		gap: 1.2cqi;
		flex-wrap: wrap;
		margin-top: 1cqi;
	}
	.id-tag {
		display: inline-block;
		font-weight: 700;
		font-size: 2.9cqi;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--color-base-content, currentColor);
		opacity: 0.55;
	}
	.id-tag--teal {
		color: var(--cmc-teal);
		opacity: 0.6;
		&:has(+ .id-tag--teal)::after {
			content: ', ';
		}
	}
	.id-tag--band {
		color: var(--color-secondary);
		opacity: 0.6;

		&:has(+ .id-tag--band)::after {
			content: ', ';
		}
	}

	.id-tag--genre {
		&:has(+ .id-tag--genre)::after {
			content: ', ';
		}
	}
	.id-card__bands {
		display: flex;
		gap: 1.2cqi;
		flex-wrap: wrap;
	}
	.id-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 5cqi 3cqi;
		gap: 3cqi;
	}
	.id-card__flags {
		display: flex;
		gap: 2cqi;
		flex-wrap: wrap;
	}
	.id-card__flags :global(.id-card__flag-icon) {
		width: 5cqi;
		height: 5cqi;
		color: var(--cmc-orange);
		opacity: 0.85;
	}
	.id-card__since {
		font-size: 2.6cqi;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-base-content, currentColor);
		opacity: 0.4;
		white-space: nowrap;
	}
</style>
