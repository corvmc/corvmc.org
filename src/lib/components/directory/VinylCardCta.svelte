<script lang="ts">
	import logoMono from '$lib/assets/cmc-logo-mono.svg';

	interface Props {
		href?: string;
	}

	let { href = '/login?register' }: Props = $props();
</script>

<a {href} class="vinyl-card vinyl-card--cta">
	<div class="vinyl-card__sleeve-wrap">
		<div class="vinyl-card__disc">
			<div class="vinyl-card__label">
				<svg class="vinyl-card__arc" viewBox="0 0 100 100">
					<defs>
						<path id="arc-top-cta" d="M 15,50 a 35,35 0 1,1 70,0" fill="none" />
						<path id="arc-bot-cta" d="M 85,50 a 35,35 0 1,1 -70,0" fill="none" />
					</defs>
					<text>
						<textPath href="#arc-top-cta" startOffset="50%" text-anchor="middle">Your Band</textPath
						>
					</text>
					<text>
						<textPath href="#arc-bot-cta" startOffset="50%" text-anchor="middle"
							>Corvallis Music Collective</textPath
						>
					</text>
				</svg>
				<img class="vinyl-card__logo" src={logoMono} alt="" />
			</div>
		</div>
		<div class="vinyl-card__sleeve">
			<div class="vinyl-card__sleeve-art">
				<div class="vinyl-card__placeholder">
					<span class="vinyl-card__question">?</span>
				</div>
			</div>
		</div>
	</div>
	<div class="vinyl-card__caption">
		<div class="vinyl-card__band">Your band here</div>
		<div class="vinyl-card__meta">Join the collective &rarr;</div>
	</div>
</a>

<style lang="postcss">
	.vinyl-card {
		position: relative;
		display: block;
		width: 100%;
		max-width: 220px;
		cursor: pointer;
		--vinyl-label: var(--cmc-teal);
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
		.vinyl-card__meta {
			color: var(--cmc-teal);
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
		z-index: 2;
		transition: transform 500ms cubic-bezier(0.34, 1.2, 0.64, 1);
		border: 2px dashed var(--cmc-teal);
	}
	.vinyl-card__sleeve-wrap {
		position: relative;
		transition: transform 500ms cubic-bezier(0.34, 1.2, 0.64, 1);
	}

	.vinyl-card__sleeve-art {
		aspect-ratio: 1;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	.vinyl-card__placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--cmc-teal);
		opacity: 0.12;
	}
	.vinyl-card__question {
		font-weight: 700;
		font-size: 3rem;
		color: var(--cmc-navy);
		opacity: 1;
	}
	.vinyl-card__caption {
		padding: 8px 2px 0;
	}
	.vinyl-card__band {
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--cmc-navy);
		line-height: 1.2;
	}
	.vinyl-card__meta {
		font-size: 0.7rem;
		color: var(--fg-2);
		margin-top: 2px;
		font-weight: 600;
		transition: color 220ms ease;
	}

	.vinyl-card:hover .vinyl-card__sleeve {
		border-style: solid;
		border-color: var(--cmc-brown);
	}
</style>
