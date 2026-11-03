<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg viewBox="0 0 220 270" class={className} xmlns="http://www.w3.org/2000/svg">
	<defs>
		<pattern id="sl-tape" width="6" height="1" patternUnits="userSpaceOnUse">
			<rect width="5" height="1" fill="#e5771e" />
			<rect x="5" width="1" height="1" fill="rgba(0,0,0,0.10)" />
		</pattern>
	</defs>

	<g>
		<!-- Paper -->
		<rect x="0" y="10" width="220" height="260" fill="#f4ead8" />

		<!-- Tape strips -->
		<rect
			x="10"
			y="2"
			width="42"
			height="17"
			rx="1"
			fill="url(#sl-tape)"
			transform="rotate(-14, 31, 10)"
		/>
		<rect
			x="168"
			y="2"
			width="42"
			height="17"
			rx="1"
			fill="url(#sl-tape)"
			transform="rotate(11, 189, 10)"
		/>

		<!-- Header -->
		<text
			x="18"
			y="52"
			font-size="18"
			fill="#16140f"
			style="font-family: var(--font-chalk);"
			transform="rotate(-1, 18, 52)">{m.illustrations_setlist_week()}</text
		>
		<text
			x="18"
			y="66"
			font-size="11"
			font-weight="600"
			fill="rgba(22,20,15,0.6)"
			style="font-family: var(--font-script);">{m.illustrations_setlist_recurring_schedule()}</text
		>

		<!-- Items -->
		<!-- 1. Real Book Club -->
		<text
			x="18"
			y="92"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.55)"
			style="font-family: var(--font-script);">1.</text
		>
		<text
			x="36"
			y="92"
			font-size="14"
			font-weight="600"
			fill="#16140f"
			style="font-family: var(--font-script);">{m.illustrations_setlist_real_book_club()}</text
		>
		<text
			x="202"
			y="92"
			text-anchor="end"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.6)"
			style="font-family: var(--font-script);">{m.illustrations_setlist_1st_thu()}</text
		>
		<line
			x1="18"
			y1="97"
			x2="202"
			y2="97"
			stroke="rgba(22,20,15,0.18)"
			stroke-width="1"
			stroke-dasharray="3,3"
		/>

		<!-- 2. Songwriter Circle -->
		<text
			x="18"
			y="118"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.55)"
			style="font-family: var(--font-script);">2.</text
		>
		<text
			x="36"
			y="118"
			font-size="14"
			font-weight="600"
			fill="#16140f"
			style="font-family: var(--font-script);">{m.illustrations_setlist_songwriter_circle()}</text
		>
		<text
			x="202"
			y="118"
			text-anchor="end"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.6)"
			style="font-family: var(--font-script);">{m.illustrations_setlist_2nd_sat()}</text
		>
		<line
			x1="18"
			y1="123"
			x2="202"
			y2="123"
			stroke="rgba(22,20,15,0.18)"
			stroke-width="1"
			stroke-dasharray="3,3"
		/>

		<!-- 3. Open Practice -->
		<text
			x="18"
			y="144"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.55)"
			style="font-family: var(--font-script);">3.</text
		>
		<text
			x="36"
			y="144"
			font-size="14"
			font-weight="600"
			fill="#16140f"
			style="font-family: var(--font-script);">{m.illustrations_setlist_open_practice()}</text
		>
		<text
			x="202"
			y="144"
			text-anchor="end"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.6)"
			style="font-family: var(--font-script);">{m.illustrations_setlist_weekly()}</text
		>
		<line
			x1="18"
			y1="149"
			x2="202"
			y2="149"
			stroke="rgba(22,20,15,0.18)"
			stroke-width="1"
			stroke-dasharray="3,3"
		/>

		<!-- 4. Monthly Meetup -->
		<text
			x="18"
			y="170"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.55)"
			style="font-family: var(--font-script);">4.</text
		>
		<text
			x="36"
			y="170"
			font-size="14"
			font-weight="600"
			fill="#16140f"
			style="font-family: var(--font-script);">{m.illustrations_setlist_monthly_meetup()}</text
		>
		<text
			x="202"
			y="170"
			text-anchor="end"
			font-size="12"
			font-weight="600"
			fill="rgba(22,20,15,0.6)"
			style="font-family: var(--font-script);">{m.illustrations_setlist_last_thu()}</text
		>
		<line
			x1="18"
			y1="175"
			x2="202"
			y2="175"
			stroke="rgba(22,20,15,0.18)"
			stroke-width="1"
			stroke-dasharray="3,3"
		/>

		<!-- Encore -->
		<line x1="18" y1="192" x2="202" y2="192" stroke="rgba(22,20,15,0.55)" stroke-width="2" />
		<text
			x="18"
			y="212"
			font-size="15"
			fill="#c63015"
			style="font-family: var(--font-chalk);"
			transform="rotate(-1.4, 18, 212)"
			>{m.illustrations_setlist_open_jam_after_every_meetup()}</text
		>
	</g>
</svg>

<style>
	svg {
		transition:
			rotate 350ms cubic-bezier(0.25, 0.7, 0.3, 1),
			translate 350ms cubic-bezier(0.25, 0.7, 0.3, 1);
	}
	:global(.program-block:has(.program-block__cta:hover)) svg {
		rotate: 0.8deg;
		translate: 0 -3px;
	}
</style>
