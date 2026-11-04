<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 110 180" class={className} xmlns="http://www.w3.org/2000/svg">
	<defs>
		<linearGradient id="kf-bg" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="#234866" />
			<stop offset="100%" stop-color="#163049" />
		</linearGradient>
		<linearGradient id="kf-sheen" x1="0" y1="0" x2="1" y2="0.6">
			<stop offset="30%" stop-color="rgba(255,255,255,0)" />
			<stop offset="48%" stop-color="rgba(255,255,255,0.10)" />
			<stop offset="60%" stop-color="rgba(255,255,255,0)" />
		</linearGradient>
	</defs>

	<!-- Body -->
	<rect width="110" height="180" rx="8" fill="url(#kf-bg)" />
	<rect width="110" height="180" rx="8" fill="url(#kf-sheen)" />

	<!-- Brass ring -->
	<circle cx="55" cy="14" r="9" fill="#c08a1a" />
	<circle cx="55" cy="14" r="3" fill="#0d0f12" />

	<!-- Room number -->
	<text
		x="55"
		y="88"
		text-anchor="middle"
		font-weight="700"
		font-size="52"
		letter-spacing="-1.5"
		fill="#f4ead8">03</text
	>

	<!-- Label -->
	<text
		x="55"
		y="108"
		text-anchor="middle"
		font-size="11"
		letter-spacing="0.5"
		fill="#f4ead8"
		style="font-family: var(--font-chalk); text-transform: uppercase;"
		transform="rotate(-1, 55, 108)"
	>
		<tspan x="55" dy="0">{m.illustrations_keyfob_practice_room()}</tspan>
	</text>

	<!-- Tri-color stripe -->
	<rect y="120" width="110" height="3" fill="#00859b" />
	<rect y="123" width="110" height="3" fill="#ffb500" />
	<rect y="126" width="110" height="3" fill="#f84d13" />

	<!-- Hours -->
	<text
		x="55"
		y="155"
		text-anchor="middle"
		font-weight="700"
		font-size="13"
		letter-spacing="1"
		fill="#c4cfde"
		style="font-family: 'Courier New', ui-monospace, monospace;"
		>{m.illustrations_keyfob_10a_10p()}</text
	>
</svg>

<style>
	svg {
		transition: rotate 350ms cubic-bezier(0.25, 0.7, 0.3, 1);
	}
	:global(.program-block:has(.program-block__cta:hover)) svg {
		rotate: 4deg;
	}
</style>
