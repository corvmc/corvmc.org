<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 282 110" class="ticket-svg {className}" xmlns="http://www.w3.org/2000/svg">
	<defs>
		<!-- Main zigzag right edge -->
		<clipPath id="tk-main-clip">
			<path
				d="M0,0 L226,0 L223,5 L226,10 L223,15 L226,20 L223,25 L226,30 L223,35 L226,40 L223,45 L226,50 L223,55 L226,60 L223,65 L226,70 L223,75 L226,80 L223,85 L226,90 L223,95 L226,100 L223,105 L226,110 L0,110 Z"
			/>
		</clipPath>
		<!-- Stub zigzag left edge -->
		<clipPath id="tk-stub-clip">
			<path
				d="M232,0 L282,0 L282,110 L232,110 L235,105 L232,100 L235,95 L232,90 L235,85 L232,80 L235,75 L232,70 L235,65 L232,60 L235,55 L232,50 L235,45 L232,40 L235,35 L232,30 L235,25 L232,20 L235,15 L232,10 L235,5 Z"
			/>
		</clipPath>
	</defs>

	<!-- Main body -->
	<rect x="0" y="0" width="226" height="110" rx="3" fill="#edc46a" clip-path="url(#tk-main-clip)" />

	<!-- Eyebrow -->
	<text
		x="14"
		y="18"
		font-weight="700"
		font-size="8"
		letter-spacing="1.8"
		fill="#c63015"
		style="font-family: ui-monospace, Menlo, monospace; text-transform: uppercase;"
		>{m.illustrations_ticket_corvallis_music_collective_text()}</text
	>

	<!-- Title -->
	<text x="14" y="42" font-size="19" fill="#1a1410" style="font-family: var(--font-chalk);"
		>{m.illustrations_ticket_showcase_night_text()}</text
	>

	<!-- When -->
	<text
		x="14"
		y="60"
		font-weight="700"
		font-size="15"
		fill="#1a1410"
		style="font-family: var(--font-script);">{m.illustrations_ticket_fri_dec_13_7_pm_text()}</text
	>

	<!-- Where -->
	<text
		x="14"
		y="75"
		font-size="12"
		fill="rgba(26,20,16,0.72)"
		style="font-family: var(--font-script);"
		>{m.illustrations_ticket_6775_sw_philomath_blvd_text()}</text
	>

	<!-- Dashed line -->
	<line
		x1="14"
		y1="86"
		x2="216"
		y2="86"
		stroke="rgba(26,20,16,0.4)"
		stroke-width="1.5"
		stroke-dasharray="4,3"
	/>

	<!-- Price -->
	<text
		x="14"
		y="100"
		font-weight="700"
		font-size="9"
		letter-spacing="1.1"
		fill="#c63015"
		style="font-family: ui-monospace, Menlo, monospace; text-transform: uppercase;"
		>{m.illustrations_ticket_5_notaflof_text()}</text
	>
	<text
		x="216"
		y="100"
		text-anchor="end"
		font-weight="700"
		font-size="9"
		letter-spacing="1.1"
		fill="rgba(26,20,16,0.55)"
		style="font-family: ui-monospace, Menlo, monospace; text-transform: uppercase;"
		>{m.illustrations_ticket_doors_6_30_text()}</text
	>

	<!-- Perforation -->
	<line
		class="ticket-perf"
		x1="228"
		y1="0"
		x2="228"
		y2="110"
		stroke="rgba(26,20,16,0.55)"
		stroke-width="1.5"
		stroke-dasharray="3,3"
	/>

	<!-- Stub -->
	<g class="ticket-stub">
		<rect
			x="232"
			y="0"
			width="50"
			height="110"
			rx="3"
			fill="#dfb04f"
			clip-path="url(#tk-stub-clip)"
		/>
		<text
			x="257"
			y="90"
			font-weight="700"
			font-size="11"
			letter-spacing="2.8"
			fill="#c63015"
			transform="rotate(-90, 257, 55)"
			style="text-transform: uppercase;">{m.illustrations_ticket_admit_one_text()}</text
		>
	</g>
</svg>

<style>
	.ticket-stub {
		transition: transform 350ms cubic-bezier(0.25, 0.7, 0.3, 1);
		transform-origin: right center;
	}
	.ticket-perf {
		transition: opacity 250ms ease;
	}
	.ticket-svg:hover .ticket-stub,
	:global(.program-block:has(.program-block__cta:hover)) .ticket-stub {
		transform: translateX(36px) rotate(7deg);
	}
	.ticket-svg:hover .ticket-perf,
	:global(.program-block:has(.program-block__cta:hover)) .ticket-perf {
		opacity: 0;
	}
</style>
