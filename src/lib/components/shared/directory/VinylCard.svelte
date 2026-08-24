<script lang="ts">
	import logoMono from '$lib/assets/cmc-logo-mono.svg';
	import { hashPattern } from '$lib/utils/patterns';
	import { initials } from '$lib/utils/format';
	import { imageSrc } from '$lib/utils/images';

	interface Props {
		href: string;
		name: string;
		avatarUrl?: string | null;
		tagline?: string | null;
		memberCount: number;
		lookingForMembers?: boolean;
		color?: string;
		id: string;
	}

	let {
		href,
		name,
		avatarUrl,
		tagline,
		memberCount,
		lookingForMembers = false,
		color = 'var(--cmc-orange)',
		id
	}: Props = $props();

	const patternClass = $derived(`poster-gen--${hashPattern(name)}`);
	const sleeve = $derived(imageSrc(avatarUrl, 'gallery'));
</script>

<a {href} class="vinyl-card" style="--vinyl-label: {color}">
	<div class="vinyl-card__sleeve-wrap">
		<div class="vinyl-card__disc">
			<div class="vinyl-card__label">
				<svg class="vinyl-card__arc" viewBox="0 0 100 100">
					<defs>
						<path id="arc-top-{id}" d="M 15,50 a 35,35 0 1,1 70,0" fill="none" />
						<path id="arc-bot-{id}" d="M 85,50 a 35,35 0 1,1 -70,0" fill="none" />
					</defs>
					<text>
						<textPath href="#arc-top-{id}" startOffset="50%" text-anchor="middle">{name}</textPath>
					</text>
					<text>
						<textPath href="#arc-bot-{id}" startOffset="50%" text-anchor="middle"
							>Corvallis Music Collective</textPath
						>
					</text>
				</svg>
				<img class="vinyl-card__logo" src={logoMono} alt="" />
			</div>
		</div>
		<div class="vinyl-card__sleeve">
			<div class="vinyl-card__sleeve-art">
				{#if avatarUrl}
					<img
						src={sleeve.src}
						srcset={sleeve.srcset}
						sizes={sleeve.sizes}
						alt={name}
						class="h-full w-full object-cover"
					/>
				{:else}
					<div class="poster-gen {patternClass} vinyl-card__pattern">
						<span class="vinyl-card__initials">{initials(name)}</span>
					</div>
				{/if}
			</div>
			{#if lookingForMembers}
				<div class="vinyl-card__gaff">seeking members</div>
			{/if}
		</div>
	</div>
	<div class="vinyl-card__caption">
		<div class="vinyl-card__band">{name}</div>
		<div class="vinyl-card__meta">
			{#if tagline}
				{tagline}
			{:else}
				{memberCount} member{memberCount === 1 ? '' : 's'}
			{/if}
		</div>
	</div>
</a>

<style lang="postcss">
	.vinyl-card {
		position: relative;
		display: block;
		width: 100%;
		max-width: 220px;
		cursor: pointer;
		--vinyl-label: var(--cmc-orange);
	}
	.vinyl-card:focus,
	.vinyl-card:hover {
		z-index: 10;

		.vinyl-card__sleeve-wrap {
			transform: rotate(-3deg);
		}

		.vinyl-card__sleeve {
			transform: translateX(-8%);
		}
		.vinyl-card__disc {
			transform: translate(10%, -50%) rotate(60deg);
		}
	}

	.vinyl-card__disc {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 95%;
		aspect-ratio: 1;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		background:
			radial-gradient(circle, #1a1a1a 0 1.5%, transparent 1.6%),
			radial-gradient(circle, var(--vinyl-label) 0 30%, transparent 30.1%),
			repeating-radial-gradient(circle, #181818 0 1px, #0e0e0e 1px 2px),
			radial-gradient(circle, transparent 0 92%, rgba(255, 255, 255, 0.06) 93%, transparent 100%),
			radial-gradient(circle at 35% 35%, rgba(255, 255, 255, 0.12) 0 8%, transparent 30%), #0a0a0a;
		/* box-shadow:
			0 4px 10px rgba(0, 0, 0, 0.4),
			inset 0 0 0 1px rgba(255, 255, 255, 0.05); */
		transition: transform 500ms cubic-bezier(0.34, 1.2, 0.64, 1);
		z-index: 1;
		pointer-events: none;
	}
	.vinyl-card__label {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: 56%;
		height: 56%;
		border-radius: 50%;
		background: var(--vinyl-label);
		/* box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18); */
	}
	.vinyl-card__arc {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.vinyl-card__arc text {
		fill: #fff;
		font-weight: 700;
		font-size: 6.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.vinyl-card__arc text:last-child {
		font-size: 4.2px;
		font-weight: 600;
		letter-spacing: 0.06em;
		fill: rgba(255, 255, 255, 0.8);
	}
	.vinyl-card__logo {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 70%;
		height: 70%;
		object-fit: contain;
		filter: brightness(0) invert(1);
		opacity: 0.92;
		pointer-events: none;
	}

	.vinyl-card__sleeve {
		position: relative;
		width: 100%;
		background: var(--cmc-cream);
		/* box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.25),
			inset 0 0 0 1px rgba(0, 0, 0, 0.08); */
		z-index: 2;
		transition: transform 500ms cubic-bezier(0.34, 1.2, 0.64, 1);
	}
	.vinyl-card__sleeve-wrap {
		position: relative;
		transition: transform 500ms cubic-bezier(0.34, 1.2, 0.64, 1);
	}

	.vinyl-card__sleeve::after {
		display: none;
	}
	.vinyl-card__sleeve-art {
		aspect-ratio: 1;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.vinyl-card__pattern {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.vinyl-card__initials {
		font-weight: 700;
		font-size: 2rem;
		color: #fff;
		-webkit-text-stroke: 3px var(--cmc-brown);
		paint-order: stroke fill;
		letter-spacing: 0.02em;
		z-index: 1;
	}
	.vinyl-card__gaff {
		position: absolute;
		padding: 3px 10px;
		background: var(--color-primary);
		color: var(--color-primary-content);
		font-weight: 700;
		font-size: 0.55rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		transform: rotate(-2deg);
		z-index: 2;
		top: 8%;
		right: -6px;
		z-index: 10;
	}
	.vinyl-card__caption {
		padding: 8px 2px 0;
	}
	.vinyl-card__band {
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--cmc-teal);
		line-height: 1.2;
	}
	.vinyl-card__meta {
		font-size: 0.7rem;
		color: var(--fg-2);
		margin-top: 2px;
	}
</style>
