<script lang="ts">
	/**
	 * The channel filter, owning its own query.
	 *
	 * `getInboxEnabledChannels` is unparameterized and `updateInboxChannelConfig` refreshes it by
	 * name, so it cannot be folded into a filter-keyed page query — the mutation would have no
	 * filter set to name the wrapper with. Same call as CategoryOptions in the equipment tranche.
	 *
	 * A menu rather than a `<select>` because it has to collapse: this rides the search row inside a
	 * ~20rem list pane, where "All channels" plus a chevron is most of the row's width. Below `@md`
	 * the trigger is the channel's own glyph and nothing else.
	 */
	import { DropdownMenu } from 'bits-ui';
	import { IconCheck, IconChevronDown, IconInbox } from '@tabler/icons-svelte';
	import { getInboxEnabledChannels } from '$lib/remote/inbox.remote';
	import { channelIcon, channelLabel } from '$lib/components/inbox/channels';

	let { value = '', onselect }: { value?: string; onselect: (channel: string) => void } = $props();

	const channels = $derived(await getInboxEnabledChannels());

	// Enabled channels plus whatever the current filter names, so a thread from a
	// since-disabled channel stays reachable.
	const options = $derived([...new Set([...channels, ...(value ? [value] : [])])]);

	const Current = $derived(value ? channelIcon(value) : IconInbox);
	const label = $derived(value ? channelLabel(value) : 'All channels');

	const itemClass =
		'flex w-full cursor-pointer items-center gap-2 rounded-box px-3 py-2 text-sm data-highlighted:bg-base-200';
</script>

<DropdownMenu.Root>
	<!-- The label is the accessible name when it is showing and gone when it is
	     not, so the `aria-label` has to name the *channel* rather than the
	     control: "Channel" alone would leave a screen reader with the question
	     and none of the answer. -->
	<DropdownMenu.Trigger
		class="depth-2 btn gap-1 btn-sm"
		aria-label="Channel: {label}"
		title="Channel: {label}"
	>
		<Current size={16} />
		<span class="hidden @md:inline">{label}</span>
		<IconChevronDown size={14} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			sideOffset={4}
			align="start"
			class="z-[1000] min-w-48 rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg"
		>
			<DropdownMenu.Item class={itemClass} onSelect={() => onselect('')}>
				<IconInbox size={15} />
				All channels
				{#if !value}<IconCheck size={15} class="ml-auto" />{/if}
			</DropdownMenu.Item>

			{#each options as ch (ch)}
				{@const Icon = channelIcon(ch)}
				<DropdownMenu.Item class={itemClass} onSelect={() => onselect(ch)}>
					<Icon size={15} />
					{channelLabel(ch)}
					{#if value === ch}<IconCheck size={15} class="ml-auto" />{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
