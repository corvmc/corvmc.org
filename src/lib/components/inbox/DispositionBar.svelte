<script lang="ts">
	/**
	 * The four ways a conversation leaves the queue: Reply, Assign, Snooze,
	 * Resolve — same actions, same shortcuts, same order everywhere they appear.
	 *
	 * This replaced a row of single-purpose forms (Resolve / Reopen / Awaiting
	 * reply / Snooze-in-a-modal), which was a different four and took two
	 * interactions to snooze. Reply and Assign are not mutations at all: they
	 * hand control back to the surface that owns the composer and the assignee
	 * select, because in Daily those are somewhere else on the screen than they
	 * are in the queue.
	 *
	 * Every disposition here is reversible for ten seconds — see undo.svelte.ts.
	 * The bar itself never writes without leaving that way back.
	 */
	import { IconAlarmSnooze, IconCheck, IconRotate, IconSend, IconUser } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { disposeThread } from '$lib/remote/inbox.remote';
	import { useShortcut, shortcutLabel } from '$lib/useShortcut.svelte';
	import { dispositionToast, undoLast } from './undo.svelte';
	import { invalidateQueue } from './queue.svelte';
	import SnoozeMenu from './SnoozeMenu.svelte';

	let {
		threadId,
		status,
		awaiting = false,
		variant = 'header',
		onreply,
		onassign,
		ondisposed
	}: {
		threadId: string;
		status: 'open' | 'resolved' | 'snoozed';
		/** Open *and* waiting on the contact — the awaiting-reply marker. */
		awaiting?: boolean;
		/**
		 * `header` is the compact row above a conversation; `focus` is the
		 * full-width keyed row Daily puts under one thread at a time.
		 */
		variant?: 'header' | 'focus' | 'stacked';
		/** Put the cursor in the composer. The bar does not own it. */
		onreply?: () => void;
		/** Reveal the assignee control. Same reason. */
		onassign?: () => void;
		/** A disposition landed — the surface may want to advance past this thread. */
		ondisposed?: (action: 'resolve' | 'snooze' | 'wait' | 'reopen') => void;
	} = $props();

	// `focus` and `stacked` share their layout: a full-width row of equal
	// targets. They differ only in where they sit — Daily puts one under a
	// single thread, the phone puts one under the composer — and in size, since
	// the phone row has to clear 44px to be a touch target at all.
	const focus = $derived(variant !== 'header');
	const size = $derived(variant === 'header' ? 'sm' : 'md');

	let busy = $state(false);
	let snoozeOpen = $state(false);

	async function dispose(
		action: 'resolve' | 'snooze' | 'wait' | 'reopen',
		label: string,
		snoozedUntil?: string
	) {
		if (busy) return;
		busy = true;
		try {
			await disposeThread({ threadId, action, snoozedUntil });
			invalidateQueue();
			dispositionToast(label, threadId);
			ondisposed?.(action);
		} finally {
			busy = false;
		}
	}

	// Chorded with the platform modifier, the same convention as SubmitButton's
	// `mod+s`. These are window listeners, and as bare letters they were eaten by
	// the entire page: a focus guard covered the composer, but every other place
	// focus lands — a button, a menu item, the body after a click — still ate the
	// letter, so `E` resolved the thread instead of being typed. A chord needs no
	// guard, because nothing else on the page claims one.
	//
	// The letters are the design's except where the chord itself collides with
	// something a draft reply needs: `mod+r` is reload and `mod+a` is select-all,
	// so Reply and Assign take J and G. An action that is not on offer passes
	// `undefined`, which is how `useShortcut` is told not to listen at all.
	const replyKeys = useShortcut(
		() => (onreply ? 'mod+j' : undefined),
		() => onreply?.()
	);
	const assignKeys = useShortcut(
		() => (onassign ? 'mod+g' : undefined),
		() => onassign?.()
	);
	const snoozeKeys = useShortcut(
		() => (status === 'snoozed' ? undefined : 'mod+s'),
		() => (snoozeOpen = true)
	);
	const resolveKeys = useShortcut(
		() => (status === 'resolved' ? undefined : 'mod+e'),
		() => void dispose('resolve', 'Resolved')
	);
	// ⌘Z is the way back from all four, so it has to exist on every surface that
	// can dispose of a thread.
	useShortcut(
		() => 'mod+z',
		() => undoLast()
	);
</script>

<!-- The key replaces the icon while the modifier is held, rather than sitting
     beside it: a permanent kbd is a label for a shortcut nobody is currently
     reaching for, and the swap is what SubmitButton already does. -->
<div class="flex flex-wrap items-center gap-2 {focus ? 'w-full' : ''}">
	{#if onreply}
		<Button
			variant={focus ? 'default' : 'ghost'}
			{size}
			class={focus ? 'flex-1' : ''}
			onclick={onreply}
		>
			{#if replyKeys.modHeld && replyKeys.parsed}
				<kbd class="kbd kbd-xs">{shortcutLabel(replyKeys.parsed)}</kbd>
			{:else}
				<IconSend size={16} />
			{/if}
			Reply
		</Button>
	{/if}

	{#if onassign}
		<Button
			variant={focus ? 'default' : 'ghost'}
			{size}
			class={focus ? 'flex-1' : ''}
			onclick={onassign}
		>
			{#if assignKeys.modHeld && assignKeys.parsed}
				<kbd class="kbd kbd-xs">{shortcutLabel(assignKeys.parsed)}</kbd>
			{:else}
				<IconUser size={16} />
			{/if}
			Assign
		</Button>
	{/if}

	{#if status !== 'snoozed'}
		<SnoozeMenu
			bind:open={snoozeOpen}
			onpick={(date) => dispose('snooze', 'Snoozed', date)}
			onwait={() => dispose('wait', 'Waiting on their reply')}
		>
			{#snippet children({ props })}
				<Button
					{...props}
					variant={focus ? 'default' : 'ghost'}
					{size}
					class={focus ? 'flex-1' : ''}
					disabled={busy}
				>
					{#if snoozeKeys.modHeld && snoozeKeys.parsed}
						<kbd class="kbd kbd-xs">{shortcutLabel(snoozeKeys.parsed)}</kbd>
					{:else}
						<IconAlarmSnooze size={16} />
					{/if}
					Snooze
				</Button>
			{/snippet}
		</SnoozeMenu>
	{/if}

	<!-- Reopen is not a fifth disposition. It is the way back from the two that
	     take a thread out of the queue, and only one of them is ever offered. -->
	{#if status !== 'open' || awaiting}
		<Button
			variant="default"
			{size}
			class={focus ? 'flex-1' : ''}
			disabled={busy}
			onclick={() => dispose('reopen', 'Back in the queue')}
		>
			<IconRotate size={16} />
			{status === 'snoozed' ? 'Unsnooze' : awaiting ? 'Needs a reply' : 'Reopen'}
		</Button>
	{/if}

	{#if status !== 'resolved'}
		<Button
			variant="primary"
			{size}
			class={focus ? 'flex-1' : ''}
			disabled={busy}
			onclick={() => dispose('resolve', 'Resolved')}
		>
			{#if resolveKeys.modHeld && resolveKeys.parsed}
				<kbd class="kbd kbd-xs">{shortcutLabel(resolveKeys.parsed)}</kbd>
			{:else}
				<IconCheck size={16} />
			{/if}
			Resolve
		</Button>
	{/if}
</div>
