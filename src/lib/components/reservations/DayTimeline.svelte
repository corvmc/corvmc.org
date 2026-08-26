<script lang="ts">
	import BookerTypeIcon from './BookerTypeIcon.svelte';
	import { DEFAULT_TIMEZONE } from '$lib/config';

	type TimeSlot = {
		id: string;
		startsAt: Date;
		endsAt: Date;
		bookerType: string;
		label?: string;
		href?: string;
	};

	let {
		current,
		others = []
	}: {
		current: TimeSlot;
		others?: TimeSlot[];
	} = $props();

	// Timeline range: 9am (0%) to 10pm (100%)
	const START_HOUR = 9;
	const END_HOUR = 22;
	const RANGE = END_HOUR - START_HOUR;

	function percent(d: Date): number {
		const h = Number(
			d.toLocaleTimeString('en-GB', {
				timeZone: DEFAULT_TIMEZONE,
				hour: '2-digit',
				hour12: false
			})
		);
		const m = Number(
			d.toLocaleTimeString('en-GB', { timeZone: DEFAULT_TIMEZONE, minute: '2-digit' })
		);
		const hourDecimal = h + m / 60;
		return Math.max(0, Math.min(100, ((hourDecimal - START_HOUR) / RANGE) * 100));
	}

	function left(slot: TimeSlot): string {
		return `${percent(slot.startsAt)}%`;
	}

	function width(slot: TimeSlot): string {
		return `${percent(slot.endsAt) - percent(slot.startsAt)}%`;
	}
</script>

<div class="relative h-6 rounded bg-base-200">
	<!-- Hour labels -->
	<div
		class="pointer-events-none absolute inset-0 -top-4 flex h-[1em] items-center justify-between px-1.5"
	>
		<span class="text-[10px] opacity-40">9am</span>
		<span class="text-[10px] opacity-40">12pm</span>
		<span class="text-[10px] opacity-40">3pm</span>
		<span class="text-[10px] opacity-40">6pm</span>
		<span class="text-[10px] opacity-40">9pm</span>
	</div>

	<!-- Other reservations (background) -->
	{#each others as other (other.id)}
		{#if other.href}
			<a
				href={other.href}
				class="tooltip absolute flex h-full items-center justify-start rounded bg-secondary px-1 opacity-50"
				style="left: {left(other)}; width: {width(other)}"
				data-tip={other.label}
				title={other.label}
			>
				<BookerTypeIcon type={other.bookerType} size={16} class="text-base-100" />
			</a>
		{:else}
			<div
				class="absolute flex h-full items-center justify-start rounded bg-secondary px-1 opacity-50"
				style="left: {left(other)}; width: {width(other)}"
				title={other.label}
			>
				<BookerTypeIcon type={other.bookerType} size={16} class="text-base-100" />
			</div>
		{/if}
	{/each}

	<!-- Current reservation (foreground) -->
	<div
		class="absolute flex h-full items-center justify-start rounded bg-primary px-1 text-base-100"
		style="left: {left(current)}; width: {width(current)}"
	>
		<BookerTypeIcon type={current.bookerType} size={16} class="text-base-100" />
	</div>
</div>
