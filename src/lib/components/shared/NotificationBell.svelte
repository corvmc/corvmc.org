<script lang="ts">
	import Button from './Button.svelte';
	import { IconBell } from '@tabler/icons-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import {
		getNotifications,
		markNotificationRead,
		markAllNotificationsRead
	} from '$lib/remote/notifications.remote';

	let data = $derived(await getNotifications());
	let notifications = $derived(data.notifications);
	let unreadCount = $derived(data.unreadCount);

	let open = $state(false);
	let eventSource: EventSource | null = null;
	let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
	let retryCount = 0;
	let destroyed = false;
	const MAX_RETRIES = 5;

	function closeEventSource() {
		eventSource?.close();
		eventSource = null;
	}

	function clearPendingTimeout() {
		if (pendingTimeout) {
			clearTimeout(pendingTimeout);
			pendingTimeout = null;
		}
	}

	function connect() {
		if (destroyed) return;
		closeEventSource();

		eventSource = new EventSource('/api/notifications/stream');

		eventSource.addEventListener('init', () => {
			retryCount = 0;
		});

		eventSource.addEventListener('message', () => {
			invalidateAll();
		});

		eventSource.onerror = () => {
			closeEventSource();
			if (destroyed || retryCount >= MAX_RETRIES) return;
			const delay = 1000 * Math.pow(2, retryCount);
			retryCount++;
			pendingTimeout = setTimeout(connect, delay);
		};
	}

	function handleBeforeUnload() {
		closeEventSource();
	}

	onMount(() => {
		if (!browser) return;
		pendingTimeout = setTimeout(connect, 100);
		window.addEventListener('beforeunload', handleBeforeUnload);
	});

	onDestroy(() => {
		destroyed = true;
		clearPendingTimeout();
		closeEventSource();
		if (browser) window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	function toggleDropdown() {
		open = !open;
	}

	async function markRead(id: string) {
		await markNotificationRead({ id });
		invalidateAll();
	}

	async function markAllRead() {
		await markAllNotificationsRead();
		invalidateAll();
	}

	function timeAgo(date: Date): string {
		const diff = Date.now() - date.getTime();
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function handleClickOutside(e: MouseEvent) {
		// This handler can be invoked by the very click that unmounts the component
		// (navigation), after its reactive state is torn down — even reading `open`
		// then throws (JAVASCRIPT-SVELTEKIT-Q, JAVASCRIPT-SVELTEKIT-1A). `destroyed`
		// is a plain boolean, safe to read at any point in the lifecycle.
		if (destroyed) return;
		// Only react when the dropdown is open — avoids a reactive write on every
		// document click and skips the case where the target is detached/null.
		if (!open) return;
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.notification-bell-wrapper')) {
			open = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="notification-bell-wrapper relative">
	<Button
		variant="ghost"
		size="sm"
		shape="circle"
		onclick={toggleDropdown}
		aria-label="Notifications"
	>
		<IconBell size={20} />
		{#if unreadCount > 0}
			<span
				class="absolute -top-0.5 -right-0.5 badge h-4 min-w-4 badge-xs text-[10px] badge-primary"
			>
				{unreadCount > 99 ? '99+' : unreadCount}
			</span>
		{/if}
	</Button>

	{#if open}
		<div
			class="absolute top-full right-0 z-1000 mt-2 w-80 rounded-lg border border-base-300 bg-base-100 shadow-lg"
		>
			<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
				<span class="text-sm font-semibold">Notifications</span>
				{#if unreadCount > 0}
					<button class="text-xs text-primary hover:underline" onclick={markAllRead}>
						Mark all read
					</button>
				{/if}
			</div>

			<div class="max-h-80 overflow-y-auto">
				{#if notifications.length === 0}
					<div class="p-6 text-center text-sm text-base-content/60">No notifications yet</div>
				{:else}
					{#each notifications as n (n.id)}
						{@const isUnread = !n.readAt}
						<div class="relative">
							{#if n.href}
								<a
									href={n.href}
									class="border-base-300/50} block border-b px-4 py-3 transition-colors hover:bg-base-200"
									class:bg-primary={isUnread}
									onclick={() => {
										if (isUnread) markRead(n.id);
										open = false;
									}}
								>
									<div class="flex items-start gap-2">
										{#if isUnread}
											<span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"></span>
										{:else}
											<span class="w-2 shrink-0"></span>
										{/if}
										<div class="min-w-0">
											<p class="truncate text-sm font-medium">{n.title}</p>
											{#if n.body}
												<p class="truncate text-xs text-base-content/60">{n.body}</p>
											{/if}
											<p class="mt-0.5 text-xs text-base-content/40">{timeAgo(n.createdAt)}</p>
										</div>
									</div>
								</a>
							{:else}
								<div class="border-b border-base-300/50 px-4 py-3" class:bg-primary={isUnread}>
									<div class="flex items-start gap-2">
										{#if isUnread}
											<button
												class="mt-1.5 h-2 w-2 shrink-0 cursor-pointer rounded-full bg-primary"
												onclick={() => markRead(n.id)}
												aria-label="Mark as read"
											></button>
										{:else}
											<span class="w-2 shrink-0"></span>
										{/if}
										<div class="min-w-0">
											<p class="truncate text-sm font-medium">{n.title}</p>
											{#if n.body}
												<p class="truncate text-xs text-base-content/60">{n.body}</p>
											{/if}
											<p class="mt-0.5 text-xs text-base-content/40">{timeAgo(n.createdAt)}</p>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
