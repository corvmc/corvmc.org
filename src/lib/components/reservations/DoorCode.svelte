<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { formatTime } from '#lib/utils/format.js';
	import { doorCodeWindow } from '#lib/utils/door-code-window.js';

	/**
	 * The one place a reservation's door code is rendered (#3173). The lock
	 * rejects a code outside its window, so before the window the code carries
	 * the time it opens, and after it the digits are gone. `children` is the
	 * keypad instruction, dropped with the digits once the window is over.
	 * `bookedUntil` is the end of a booking that runs into the early-open
	 * minutes (#3181); the code still works, so it is stated, not enforced.
	 */
	let {
		code,
		startsAt,
		endsAt,
		kind = 'own',
		size = 'lg',
		now,
		bookedUntil = null,
		children
	}: {
		code: string;
		startsAt: Date;
		endsAt: Date;
		kind?: 'own' | 'fallback';
		size?: 'sm' | 'md' | 'lg';
		now?: Date;
		bookedUntil?: Date | null;
		children?: Snippet;
	} = $props();

	const win = $derived(doorCodeWindow({ startsAt, endsAt }, kind, now));
	const opensAt = $derived(formatTime(win.opensAt));
	const bookedBefore = $derived(
		bookedUntil
			? m.reservations_door_code_booked_before_text({ time: formatTime(bookedUntil) })
			: null
	);
</script>

{#if size === 'sm'}
	<span data-door-code={win.phase}>
		{#if win.phase === 'over'}
			<span class="text-muted">{m.reservations_door_code_expired_text()}</span>
		{:else}
			<span class="font-mono font-bold tracking-wider">{code}</span>
			{#if win.phase === 'before'}
				<span class="text-muted"
					>· {m.reservations_door_code_works_from_text({ time: opensAt })}</span
				>
			{/if}
			{#if bookedBefore}
				<span class="block text-warning" data-door-code-booked-before>{bookedBefore}</span>
			{/if}
		{/if}
	</span>
{:else}
	<div data-door-code={win.phase}>
		{#if win.phase === 'over'}
			<p class="text-muted">{m.reservations_door_code_expired_text()}</p>
		{:else}
			<p
				class={size === 'lg'
					? 'font-mono text-4xl font-bold tracking-[0.3em]'
					: 'font-mono text-2xl font-bold tracking-[0.2em]'}
			>
				{code}
			</p>
			{#if win.phase === 'before'}
				<p class="font-medium">{m.reservations_door_code_works_from_text({ time: opensAt })}</p>
			{/if}
			{#if bookedBefore}
				<p class="text-warning" data-door-code-booked-before>{bookedBefore}</p>
			{/if}
			{@render children?.()}
		{/if}
	</div>
{/if}
