<script lang="ts">
	import { getInboxEnabledChannels } from '$lib/remote/inbox.remote';
	import { channelLabel } from '$lib/components/inbox/channels';

	/**
	 * The channel filter's `<option>` list, owning its own query.
	 *
	 * `getInboxEnabledChannels` is unparameterized and `updateInboxChannelConfig` refreshes it by
	 * name, so it cannot be folded into a filter-keyed page query — the mutation would have no
	 * filter set to name the wrapper with. Same call as CategoryOptions in the equipment tranche.
	 */
	let { current = '' }: { current?: string } = $props();

	const channels = $derived(await getInboxEnabledChannels());
</script>

<option value="">All channels</option>
<!-- Enabled channels plus whatever the current filter names, so a thread
     from a since-disabled channel stays reachable. -->
{#each [...new Set([...channels, ...(current ? [current] : [])])] as ch (ch)}
	<option value={ch}>{channelLabel(ch)}</option>
{/each}
