<script lang="ts">
	import {
		IconGripVertical,
		IconChevronUp,
		IconChevronDown,
		IconEye,
		IconEyeOff,
		IconAdjustmentsHorizontal,
		IconArrowUpRight
	} from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { BLOCK_LABELS } from '$lib/utils/band-site-preset';
	import { BLOCK_SOURCES } from './block-editing';
	import type { Block } from '$lib/types/band-page';

	/**
	 * The control strip a block carries in the editor.
	 *
	 * It renders *in the flow*, at the block's own width, pushing the page down
	 * rather than floating over it — so nothing the band is trying to look at is
	 * ever covered by the thing they are using to change it. It is drawn from the
	 * app's palette, never the band's theme, which is what keeps it legible on a
	 * near-black punk page and readable as tooling rather than as design.
	 */
	let {
		block,
		index,
		total,
		open = false,
		hasSettings = false,
		slug,
		onMove,
		onToggleHidden,
		onToggleOpen,
		onGrab
	}: {
		block: Block;
		index: number;
		total: number;
		open?: boolean;
		hasSettings?: boolean;
		slug: string;
		onMove: (direction: -1 | 1) => void;
		onToggleHidden: () => void;
		onToggleOpen: () => void;
		/** Arms the drag. Pointer-down on the grip only — see `BandSiteRenderer`. */
		onGrab: () => void;
	} = $props();

	const source = $derived(BLOCK_SOURCES[block.type]);
	const label = $derived(BLOCK_LABELS[block.type].label);
	const hidden = $derived(block.hidden === true);
	const ownerHref = $derived(source.owner ? resolve(`/band/${slug}/${source.owner}`) : null);
</script>

<div
	class="flex h-8 items-center gap-2.5 px-2 text-[11px] font-semibold tracking-wide uppercase
	       {open ? 'bg-primary text-primary-content' : 'bg-neutral text-neutral-content'}"
>
	<!-- Drag starts here and nowhere else: the block below is full of links and
	     text a band needs to be able to select. -->
	<span
		class="cursor-grab opacity-50 active:cursor-grabbing"
		aria-hidden="true"
		onpointerdown={onGrab}
	>
		<IconGripVertical size={14} />
	</span>

	<span class="whitespace-nowrap">{label}</span>

	{#if ownerHref}
		<a
			href={ownerHref}
			class="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px]
			       font-normal tracking-normal normal-case hover:bg-white/25"
		>
			{source.label}
			<IconArrowUpRight size={11} />
		</a>
	{/if}

	<span class="flex-1"></span>

	<!-- Drag-and-drop is the fast path; these are the reliable one. They are what
	     works with a keyboard, on a touch screen that is already scrolling, and
	     when a block is taller than the viewport. -->
	<div class="flex items-center gap-px">
		<button
			type="button"
			class="flex h-[22px] w-6 items-center justify-center rounded-sm hover:bg-white/15
			       disabled:pointer-events-none disabled:opacity-25"
			aria-label="Move {label} up"
			disabled={index === 0}
			onclick={() => onMove(-1)}
		>
			<IconChevronUp size={15} />
		</button>
		<button
			type="button"
			class="flex h-[22px] w-6 items-center justify-center rounded-sm hover:bg-white/15
			       disabled:pointer-events-none disabled:opacity-25"
			aria-label="Move {label} down"
			disabled={index === total - 1}
			onclick={() => onMove(1)}
		>
			<IconChevronDown size={15} />
		</button>
		<button
			type="button"
			class="flex h-[22px] w-6 items-center justify-center rounded-sm hover:bg-white/15"
			aria-label={hidden ? `Publish ${label}` : `Stop publishing ${label}`}
			aria-pressed={!hidden}
			onclick={onToggleHidden}
		>
			{#if hidden}
				<IconEyeOff size={15} />
			{:else}
				<IconEye size={15} />
			{/if}
		</button>
		{#if hasSettings}
			<button
				type="button"
				class="flex h-[22px] w-6 items-center justify-center rounded-sm hover:bg-white/15"
				aria-label="{label} settings"
				aria-expanded={open}
				onclick={onToggleOpen}
			>
				<IconAdjustmentsHorizontal size={15} />
			</button>
		{/if}
	</div>
</div>
