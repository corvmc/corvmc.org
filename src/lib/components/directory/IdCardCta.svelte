<script lang="ts">
	import speakerLogo from '$lib/assets/cmc-speaker-icon.svg';
	import { resolve } from '$app/paths';

	interface Props {
		href?: string;
	}

	let { href = `${resolve('/login')}?register` }: Props = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href defaults to a resolve()d internal path with a query string; the rule can't trace it through the prop default -->
<a {href} class="id-card id-card--cta">
	<div class="id-card__header">
		<div class="id-card__brand">
			<img src={speakerLogo} alt="" class="id-card__logo" />
			<span>Corvallis Music<br />Collective</span>
		</div>
		<div class="id-card__tag">MEMBER</div>
	</div>
	<div class="id-card__body">
		<div class="id-card__photo">
			<div class="id-card__placeholder">
				<span class="id-card__question">?</span>
			</div>
		</div>
		<div class="id-card__info">
			<div class="id-card__name">Your name here</div>
			<div class="id-card__role">Join the collective</div>
			<div class="id-card__cta-arrow">Get started &rarr;</div>
		</div>
	</div>
	<div class="id-card__footer">
		<div class="id-card__since">Member since {new Date().getFullYear()}</div>
		<div class="id-card__barcode" aria-hidden="true"></div>
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
		border: 2px dashed var(--cmc-teal);
		overflow: visible;
		transform: rotate(var(--tilt, 0.6deg));
		transition:
			transform 220ms cubic-bezier(0.34, 1.4, 0.64, 1),
			box-shadow 220ms ease,
			border-color 220ms ease;
		cursor: pointer;
		padding: 0;
		aspect-ratio: 5 / 3;
		container-type: inline-size;
	}
	.id-card:focus,
	.id-card:hover {
		transform: rotate(0deg) translateY(-3px);
		border-color: var(--cmc-brown);
		border-style: solid;
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
	.id-card__placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--cmc-teal);
		opacity: 0.15;
	}
	.id-card__question {
		font-weight: 700;
		font-size: 8cqi;
		color: var(--cmc-navy);
		opacity: 1;
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
	.id-card__role {
		font-size: 3.8cqi;
		color: var(--fg-2);
	}
	.id-card__cta-arrow {
		margin-top: auto;
		font-weight: 700;
		font-size: 3.5cqi;
		letter-spacing: 0.04em;
		color: var(--cmc-teal);
	}
	.id-card__footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding: 0 5cqi 3cqi;
		gap: 3cqi;
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
	.id-card__barcode {
		flex: 1;
		max-width: 28cqi;
		height: 5cqi;
		opacity: 0.35;
		background: repeating-linear-gradient(
			to right,
			currentColor 0 0.5cqi,
			transparent 0.5cqi 1cqi,
			currentColor 1cqi 1.3cqi,
			transparent 1.3cqi 2cqi,
			currentColor 2cqi 2.3cqi,
			transparent 2.3cqi 3.2cqi,
			currentColor 3.2cqi 3.5cqi,
			transparent 3.5cqi 4cqi,
			currentColor 4cqi 5cqi,
			transparent 5cqi 5.4cqi,
			currentColor 5.4cqi 5.7cqi,
			transparent 5.7cqi 6.5cqi
		);
	}
</style>
