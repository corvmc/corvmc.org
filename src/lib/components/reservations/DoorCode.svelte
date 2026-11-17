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
	 */
	let {
		code,
		startsAt,
		endsAt,
		kind = 'own',
		size = 'lg',
		now,
		children
	}: {
		code: string;
		startsAt: Date;
		endsAt: Date;
		kind?: 'own' | 'fallback';
		size?: 'sm' | 'md' | 'lg';
		now?: Date;
		children?: Snippet;
	} = $props();

	const win = $derived(doorCodeWindow({ startsAt, endsAt }, kind, now));
	const opensAt = $derived(formatTime(win.opensAt));
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
			{@render children?.()}
		{/if}
	</div>
{/if}
