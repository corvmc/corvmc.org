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
	import { useShortcut } from '$lib/useShortcut.svelte';
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
		variant?: 'header' | 'focus';
		/** Put the cursor in the composer. The bar does not own it. */
		onreply?: () => void;
		/** Reveal the assignee control. Same reason. */
		onassign?: () => void;
		/** A disposition landed — the surface may want to advance past this thread. */
		ondisposed?: (action: 'resolve' | 'snooze' | 'wait' | 'reopen') => void;
	} = $props();

	const focus = $derived(variant === 'focus');
	const size = $derived(focus ? 'md' : 'sm');

	let busy = $state(false);

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

	// Single letters, unmodified, exactly as the design labels them. `useShortcut`
	// listens on the window, so a keystroke while the composer has focus would
	// otherwise resolve the thread mid-sentence — hence the typing guard.
	function bind(key: string, run: () => void) {
		useShortcut(
			() => key,
			() => {
				if (isTyping()) return;
				run();
			}
		);
	}

	function isTyping() {
		const el = document.activeElement;
		if (!(el instanceof HTMLElement)) return false;
		return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
	}

	bind('r', () => onreply?.());
	bind('a', () => onassign?.());
	bind('e', () => {
		if (status !== 'resolved') void dispose('resolve', 'Resolved');
	});
	// ⌘Z carries the modifier, so it needs no typing guard of its own — but it
	// does need to exist on every surface that can dispose of a thread.
	useShortcut(
		() => 'mod+z',
		() => undoLast()
	);
</script>

<div class="flex flex-wrap items-center gap-2 {focus ? 'w-full' : ''}">
	{#if onreply}
		<Button
			variant={focus ? 'default' : 'ghost'}
			{size}
			class={focus ? 'flex-1' : ''}
			onclick={onreply}
		>
			<IconSend size={16} /> Reply
			<kbd class="kbd kbd-xs">R</kbd>
		</Button>
	{/if}

	{#if onassign}
		<Button
			variant={focus ? 'default' : 'ghost'}
			{size}
			class={focus ? 'flex-1' : ''}
			onclick={onassign}
		>
			<IconUser size={16} /> Assign
			<kbd class="kbd kbd-xs">A</kbd>
		</Button>
	{/if}

	{#if status !== 'snoozed'}
		<SnoozeMenu
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
					<IconAlarmSnooze size={16} /> Snooze
					<kbd class="kbd kbd-xs">S</kbd>
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
			<IconCheck size={16} /> Resolve
			<kbd class="kbd kbd-xs">E</kbd>
		</Button>
	{/if}
</div>
