<script lang="ts">
	import clsx from 'clsx';
	import { LinkPreview } from 'bits-ui';
	import { browser } from '$app/environment';
	import EntityIdentity from './EntityIdentity.svelte';
	import Button from '../Button.svelte';
	import { IconArrowRight } from '@tabler/icons-svelte';
	import type { EntityRef } from '$lib/types/entity';
	import StatusMark from './StatusMark.svelte';
	import { entityIcon, isNoteworthyStatus, toneFor } from './registry';
	import { getEntityViewer } from './context';
	import { entityHref } from '$lib/utils/entity-href';

	/**
	 * An inline reference to another record: type glyph + its distinctive name,
	 * in a chip, linked to whichever page this viewer can reach.
	 *
	 * The smallest of the four tiers. Use it wherever one record *mentions*
	 * another — the flagged item on a report, the band on a reservation, the
	 * submitter on an event.
	 *
	 * A contained chip rather than a bare link because these appear inside
	 * running prose and fact lists, where an underlined name is indistinguishable
	 * from any other link in the sentence. The container says "this is a record
	 * you can open", and the glyph says which kind — which is the entire job of
	 * this tier.
	 *
	 * Takes no `href`: see `$lib/utils/entity-href`.
	 */
	let {
		ref,
		icon = true,
		status = true,
		class: className = '',
		preview = true
	}: {
		ref: EntityRef;
		/** The type glyph. Off when surrounding context already names the type. */
		icon?: boolean;
		/**
		 * Trail a glyph when the record needs attention. Exception-only, like
		 * everywhere else — an `active` member trails nothing.
		 */
		status?: boolean;
		class?: string;
		/**
		 * RESERVED, not yet implemented — mounts `EntityIdentity` in a hover popover.
		 * Declared now so adding it later is an implementation rather than an API
		 * change.
		 */
		preview?: boolean;
	} = $props();

	const viewer = getEntityViewer();
	const href = $derived(entityHref(ref, viewer));
	const glyph = $derived(entityIcon(ref));
	/**
	 * A cancelled show and a live one were pixel-identical, which made the chip
	 * quietly lie in the one place it is most likely to be read in passing —
	 * mid-sentence, where nobody goes looking for a status column.
	 *
	 * A trailing glyph rather than a tinted border: chips run several to a
	 * paragraph, and colouring the container would shout across the whole page
	 * to say one of them is off.
	 */
	const notable = $derived(status && isNoteworthyStatus(ref.status));
	// Dim rather than brighten on hover: an untoned chip has a faint outline that
	// needs to come forward, but a toned one is already the loudest thing in the
	// line, so the hover cue is to ease off. Only when it links — hover means
	// nothing on a chip that cannot be opened.
	const tone = $derived(notable ? toneFor(ref.status) : null);
	/**
	 * A pointer that cannot hover has no way to reach a hover preview, so on
	 * touch the first tap opens it instead of following the link — the name
	 * inside the preview is then the way through. Checked per-device rather than
	 * by width: a laptop with a touchscreen still hovers.
	 */
	const coarse = $derived(browser && !window.matchMedia('(hover: hover)').matches);
	let open = $state(false);

	function onclick(event: MouseEvent) {
		if (!preview || !coarse) return;
		event.preventDefault();
		open = true;
	}

	const toneClass = $derived(
		tone ? `${tone.border} ${href ? `transition-colors ${tone.borderHover}` : ''}` : ''
	);

	const classes = $derived(
		clsx(
			// h-6 is one line box exactly (24px, matching the body leading), so a chip
			// in running prose does not push the lines apart. A Material chip is
			// taller than this, but Material chips live in chip *groups* — these have
			// to sit inside a sentence.
			// overflow-hidden so the trailing status region clips to the pill.
			'inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full border align-bottom text-sm',
			// Material's leading-icon inset: the glyph sits closer to the edge than
			// the label does, or the chip reads lopsided.
			icon ? 'pl-2' : 'pl-3',
			// The region reaches the border itself, so the chip keeps no right inset.
			notable ? 'pr-0' : 'pr-3',
			// With a status, the outline takes that status's tone, so the chip reads
			// as one object rather than a neutral pill with a coloured cap stuck on
			// the end.
			//
			// Without one, the outline is a fraction of the foreground rather than
			// `base-300`: the base ramp steps only 3–7% in lightness at the dark end
			// (page 0.14, fill 0.17, border 0.21), so a base-300 outline all but
			// vanishes there while reading fine in light. An alpha of the text
			// colour inverts with the theme and holds its contrast in both.
			toneClass ||
				(href ? 'border-base-content/25 hover:border-base-content/40' : 'border-base-content/15'),
			href
				? 'bg-base-200 transition-colors hover:bg-base-300'
				: // Unreachable or deleted. Same shape, so a list of chips stays a list
					// of chips, but nothing that suggests it can be opened.
					'bg-base-200/50 text-muted',
			className
		)
	);
</script>

{#snippet chip(triggerProps: Record<string, unknown> = {})}
	{#if href}
		<!--
			`role` is dropped from the trigger props: bits-ui sets `role="button"`,
			which is right for a trigger that only opens something but wrong for one
			that also navigates — it would announce a link as a button. The
			`aria-haspopup` it also sets is kept, since the preview really is there.
		-->
		{@const { role: _role, ...linkProps } = triggerProps}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from entityHref(), which calls resolve() internally; the rule cannot trace it through the function -->
		<a {...linkProps} {href} {onclick} class={classes}>
			{#if icon}<glyph.icon size={16} class="shrink-0" />{/if}
			<span class="min-w-0 truncate">{ref.title}</span>
			{#if notable && ref.status}<StatusMark status={ref.status} />{/if}
		</a>
	{:else}
		<span {...triggerProps} class={classes}>
			{#if icon}<glyph.icon size={16} class="shrink-0 opacity-60" />{/if}
			<span class="min-w-0 truncate">{ref.title}</span>
			{#if notable && ref.status}<StatusMark status={ref.status} />{/if}
		</span>
	{/if}
{/snippet}

{#if preview}
	<LinkPreview.Root bind:open openDelay={400} closeDelay={200}>
		<LinkPreview.Trigger>
			{#snippet child({ props })}
				{@render chip(props)}
			{/snippet}
		</LinkPreview.Trigger>
		<LinkPreview.Portal>
			<LinkPreview.Content
				sideOffset={6}
				class="z-50 max-w-xs rounded-lg border border-base-300 bg-base-100 p-3 shadow-lg"
			>
				<!--
					The `md` identity, not a bespoke summary: the point of a preview is to
					show the same thing the reader would find by following the link, and a
					second layout for it is a second thing to keep true.
				-->
				<EntityIdentity {ref} size="md" status meta={href ? open_ : undefined} />
			</LinkPreview.Content>
		</LinkPreview.Portal>
	</LinkPreview.Root>
{:else}
	{@render chip()}
{/if}

{#snippet open_()}
	<!--
		The explicit way through. On touch the chip's own tap opens this preview
		instead of navigating, so without a control here a phone could reach the
		preview and never the record. `aria-label` rather than `title`: an
		icon-only button needs a name, and Button's `title` renders a tooltip,
		which inside a hover preview is a popover on a popover.

		Same arrow `CrossRefList` already uses for "go to this record".
	-->
	<Button href={href!} shape="square" size="sm" variant="ghost" aria-label="Open {ref.title}">
		<IconArrowRight size={18} />
	</Button>
{/snippet}
