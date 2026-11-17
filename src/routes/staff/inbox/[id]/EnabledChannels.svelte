<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import { getInboxEnabledChannels } from '#lib/remote/inbox.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	type Channels = Awaited<ReturnType<typeof getInboxEnabledChannels>>;

	/**
	 * The channel config the composer is gated on. Its own component so the thread
	 * stays the page's one load-bearing query, and it starts after the thread lands.
	 * Through `Latest`, so a refresh does not remount the composer, draft and all (#2357).
	 */
	let { children }: { children: Snippet<[Channels]> } = $props();

	const channels = new Latest(() => getInboxEnabledChannels());
	const enabled = $derived(
		channels.current ?? (await getInboxEnabledChannels().catch(() => undefined))
	);
</script>

{#if enabled}
	{@render children(enabled)}
{:else if channels.error}
	<Alert type="warning" reset={() => void getInboxEnabledChannels().refresh()}>
		{m.ui_load_failed_body({ error: errorMessage(channels.error.e) })}
	</Alert>
{/if}
