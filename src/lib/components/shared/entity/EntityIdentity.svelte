<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EntityRef } from '$lib/types/entity';
	import EntityAvatar from '../directory/EntityAvatar.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import {
		entityKinds,
		entityGlyph,
		entityIcon,
		hasSubtype,
		isNoteworthyStatus,
		toneFor
	} from './registry';
	import { getEntityViewer } from './context';
	import { entityHref } from '$lib/utils/entity-href';

	/**
	 * One record's identity: its glyph or avatar, its name, the qualifiers that
	 * hold whoever is looking, and a trailing slot.
	 *
	 * The same object at three scales, which is why it is not called a row:
	 *
	 *  - `sm` — the staff table **primary cell**. Fifty-three of these were
	 *    hand-written as `<a class="block truncate font-medium hover:underline">`
	 *    plus a muted subline.
	 *  - `md` — a standalone list row with a 40px avatar.
	 *  - `lg` — the strip at the top of a record's own detail page, below
	 *    `PageHeader` and above any `TabBar`.
	 *
	 * `lg` was a separate `EntityHeader` component until it became clear the two
	 * were one thing drawn twice — and that two copies meant two places for the
	 * avatar-shape convention, the subtype glyph and the status rule to drift
	 * apart.
	 *
	 * It owns **one cell's content** and never the column set, the fetch, or the
	 * row element — `Table`, `DataList` and `use:rowLink` keep their boundaries
	 * exactly as they were. That is the line the deleted `DataTable` crossed.
	 */
	let {
		ref,
		size = 'sm',
		avatar = undefined,
		status = false,
		email,
		phone,
		heading,
		link = size !== 'lg',
		class: className = '',
		qualifiers,
		subtitle,
		meta
	}: {
		ref: EntityRef;
		size?: 'sm' | 'md' | 'lg';
		/**
		 * The media slot. Defaults on above `sm`. Types with no avatar of their
		 * own get their glyph on a tile instead of nothing — a reservation or a
		 * report still deserves an anchor for the eye.
		 */
		avatar?: boolean;
		status?: boolean;
		/**
		 * Contact affordances, used as the subline in place of `ref.subtitle`. A
		 * detail strip wants to be actionable where a list row wants to be read.
		 */
		email?: string | null;
		phone?: string | null;
		/**
		 * Render the name inside a heading, for a card whose title is the record.
		 * Omit in lists: fifty headings in a table is not an outline.
		 */
		heading?: 2 | 3 | 4;
		/**
		 * Defaults off at `lg`: that size is the strip on a record's own page, and
		 * linking a record to the page you are already reading is a dead end. Pass
		 * it explicitly for a prominent list item that should still navigate.
		 */
		link?: boolean;
		class?: string;
		/** Extra inline facts beside the name — a member number, a tier. */
		qualifiers?: Snippet;
		/** Replaces `ref.subtitle` when the subline needs markup. */
		subtitle?: Snippet;
		/** Trailing content — counts, badges, actions. Block modes only. */
		meta?: Snippet;
	} = $props();

	const viewer = getEntityViewer();
	const href = $derived(link ? entityHref(ref, viewer) : null);
	const kind = $derived(entityKinds[ref.type]);
	const showMedia = $derived(avatar ?? size !== 'sm');
	const hasAvatar = $derived(kind.shape !== 'none');
	const Icon = $derived(entityIcon(ref).icon);
	const hasContact = $derived(!!email || !!phone);
	const hasSub = $derived(hasContact || !!subtitle || !!ref.subtitle);
	const notableStatus = $derived(status && isNoteworthyStatus(ref.status));

	const avatarSize = $derived(size === 'lg' ? 'size-16' : size === 'md' ? 'size-10' : 'size-6');
	const titleSize = $derived(size === 'lg' ? 'text-lg' : '');

	/**
	 * Status rides the avatar when there is one — a ring in its tone and the
	 * glyph in the corner — and only falls back to a separate element when there
	 * is nothing to ride.
	 *
	 * One treatment, so the same record does not report its state one way in a
	 * list and another on a card. Where no avatar exists (a reservation, a
	 * report, or the bare table cell) the status becomes its own mark: the word
	 * at `lg`, where there is one record on the page and room to name it, and the
	 * glyph at the smaller sizes.
	 */
	const onAvatar = $derived(notableStatus && showMedia);
	const ringClass = $derived(onAvatar ? `ring-2 ${toneFor(ref.status)?.ring ?? ''}` : '');
	const markSize = $derived(size === 'lg' ? 'size-6' : 'size-5');
	const tileRadius = $derived(kind.shape === 'round' ? 'rounded-full' : 'rounded-lg');
	const iconSize = $derived(size === 'lg' ? 30 : 20);

	// Marked variants only — a plain member, a self-booked reservation and a CMC
	// show all resolve to nothing here, because a glyph on every row marks
	// nothing. Which cases count is a registry fact, not a branch in this file.
	const glyph = $derived(hasSubtype(ref) ? entityGlyph(ref) : null);
</script>

{#snippet titleLine()}
	{#if glyph}
		<!--
			`align-middle` alone sits the glyph ~2px low: it aligns to the baseline
			plus half an x-height, not to the middle of the line. One line tall,
			topped to the line box, centring its contents puts the glyph's centre on
			the line's centre exactly — and keeps it inline, so the anchor stays
			`block truncate` and the cell-primary contract holds.
		-->
		<span class="tooltip mr-1 inline-flex h-[1lh] items-center align-top" data-tip={glyph.label}>
			<glyph.icon size={14} />
		</span>
	{/if}{ref.title}
{/snippet}

{#snippet titleText()}
	{#if href}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from entityHref(), which calls resolve() internally; the rule cannot trace it through the function -->
		<a {href} class="block min-w-0 truncate font-medium hover:underline {heading ? '' : titleSize}"
			>{@render titleLine()}</a
		>
	{:else}
		<span class="block min-w-0 truncate font-medium {heading ? '' : titleSize}"
			>{@render titleLine()}</span
		>
	{/if}
{/snippet}

{#snippet titleRow()}
	<div class="flex flex-wrap items-baseline gap-2">
		{#if heading}
			<!--
				`truncate` on the inner element, never on the heading: `layout.css`
				sets `text-wrap: balance` on h1–h6 unlayered, and unlayered CSS beats
				every @layer, so nowrap silently fails to apply there.
			-->
			<svelte:element this={`h${heading}`} class="min-w-0 font-semibold {titleSize}">
				{@render titleText()}
			</svelte:element>
		{:else}
			{@render titleText()}
		{/if}
		{#if ref.type === 'member' && ref.pronouns}
			<!-- Narrowing the union to read a field only one arm has, which is not
			     the same as branching on type to decide *behaviour* — that belongs in
			     the registry. Pronouns are a fact about this record, and only members
			     have them. -->
			<span class="text-muted">{ref.pronouns}</span>
		{/if}
		{#if qualifiers}{@render qualifiers()}{/if}
		{#if size === 'lg' && notableStatus && !onAvatar && ref.status}
			<StatusBadge status={ref.status} label />
		{/if}
	</div>
{/snippet}

{#if size === 'sm' && !showMedia}
	<!--
		NO WRAPPER. `cell-primary` is `width:100%; max-width:0`, and `truncate`
		only resolves against that when the anchor is a *direct* block child of
		the cell. Wrapping these two in a <div> silently un-truncates every list
		in the app, and nothing throws — the same failure `Fact` renders bare
		<dt>/<dd> to avoid. The spec pins this.
	-->
	{#if href}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href comes from entityHref(), which calls resolve() internally; the rule cannot trace it through the function -->
		<a {href} class="block truncate font-medium hover:underline {className}"
			>{@render titleLine()}</a
		>
	{:else}
		<span class="block truncate font-medium {className}">{@render titleLine()}</span>
	{/if}
	{#if hasSub}
		<div class="truncate text-muted">
			{#if subtitle}{@render subtitle()}{:else}{ref.subtitle}{/if}
		</div>
	{/if}
{:else}
	<div class="flex min-w-0 items-center {size === 'lg' ? 'gap-4' : 'gap-3'} {className}">
		{#if size !== 'lg' && notableStatus && !onAvatar && ref.status}
			<StatusBadge status={ref.status} />
		{/if}
		{#if showMedia}
			<div class="relative shrink-0">
				{#if hasAvatar}
					<EntityAvatar
						shape={kind.shape === 'round' ? 'round' : 'square'}
						name={ref.title}
						image={ref.image}
						size={size === 'lg' ? 'avatar-md' : 'avatar-sm'}
						class="{avatarSize} {ringClass}"
					/>
				{:else}
					<!-- No avatar of its own, so the glyph at size. Initials would only
					     spell out two letters of the name printed beside them. -->
					<div
						class="flex {avatarSize} items-center justify-center bg-base-200 {tileRadius} {ringClass}"
						aria-hidden="true"
					>
						<Icon size={iconSize} class="text-subtle" />
					</div>
				{/if}
				{#if onAvatar && ref.status}
					<span
						class="absolute -right-1 -bottom-1 flex {markSize} items-center justify-center rounded-full bg-base-100"
					>
						<StatusBadge status={ref.status} size={size === 'lg' ? 19 : 16} />
					</span>
				{/if}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			{@render titleRow()}
			{#if hasSub}
				<div class="truncate text-muted">
					{#if hasContact}{@render contact()}{:else if subtitle}{@render subtitle()}{:else}{ref.subtitle}{/if}
				</div>
			{/if}
		</div>
		{#if meta}
			<div class="flex shrink-0 gap-2">{@render meta()}</div>
		{/if}
	</div>
{/if}

{#snippet contact()}
	{#if email}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- mailto:, not an internal route -->
		<a class="link" href="mailto:{email}">{email}</a>
	{/if}
	{#if email && phone}·{/if}
	{#if phone}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tel:, not an internal route -->
		<a class="link" href="tel:{phone}">{phone}</a>
	{/if}
{/snippet}
