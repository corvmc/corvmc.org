<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EntityRef } from '$lib/types/entity';
	import Card from '../Card/Card.svelte';
	import CardBody from '../Card/CardBody.svelte';
	import EntityIdentity from './EntityIdentity.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { imageSrc } from '$lib/utils/images';
	import { entityKinds, entityIcon, toneFor, isNoteworthyStatus } from './registry';

	/**
	 * One record, expanded: image, name, status, a few facts, and its actions.
	 *
	 * This is what a *related* record looks like on someone else's detail page —
	 * the band on an event, the member on a reservation. Bigger than a row,
	 * smaller than the page itself.
	 *
	 * Built on `Card`/`CardBody` rather than `InfoCard` on purpose: an
	 * `InfoCard`'s title is a section label ("Payment"), whereas this card's
	 * title *is* the record and links to it. Overloading `InfoCard`'s `header`
	 * snippet for that reproduces the "hardcoded to one shape" problem that
	 * motivated `Card` in the first place.
	 */
	let {
		ref,
		media = 'auto',
		status = true,
		class: className = '',
		facts,
		actions,
		children
	}: {
		ref: EntityRef;
		/**
		 * `auto` follows the registry: a poster type gets the full-bleed portrait,
		 * everything else gets whatever `EntityIdentity` draws beside the title.
		 * Override to force the poster treatment, or to drop the media entirely.
		 */
		media?: 'auto' | 'poster' | 'none';
		status?: boolean;
		class?: string;
		/** A `DefinitionList` of the facts worth showing at this size. */
		facts?: Snippet;
		/**
		 * Buttons for this record, riding the card's bottom edge. Pass
		 * `size="xs"` — these sit on a boundary and a full-size button swamps it.
		 */
		actions?: Snippet;
		children?: Snippet;
	} = $props();

	const kind = $derived(entityKinds[ref.type]);
	const Icon = $derived(entityIcon(ref).icon);

	/**
	 * A poster type turns the whole card portrait: full-bleed 2:3 artwork with
	 * the text underneath, the way a poster is actually looked at. The other
	 * shapes keep the media as a small tile beside the text.
	 *
	 * Keyed off the *shape*, not off whether an image loaded, so an event with no
	 * artwork yet is still a portrait card and a grid of them stays even.
	 */
	const isPoster = $derived(media === 'poster' || (media === 'auto' && kind.shape === 'poster'));
	const poster = $derived(ref.image ? imageSrc(ref.image, 'poster') : null);

	/**
	 * Status rides on the media rather than sitting beside the title: an outline
	 * in its colour, and the glyph in the corner.
	 *
	 * A labelled badge on the title line was reading louder than the record's own
	 * name, and on a poster card it clipped every title to an ellipsis. The mark
	 * is the unlabelled `StatusBadge`, so it keeps that component's tooltip and
	 * its humanised label — icon-only here does not mean unlabelled to a reader.
	 *
	 * With `media="none"` there is no media to ride on, so the badge stays inline.
	 */
	// Exception-only, like subtypes: an `active` member or a `published` listing
	// is in its expected state and gets no mark at all.
	const notable = $derived(status && isNoteworthyStatus(ref.status));
	// Only the poster carries status here; every other shape hands it to
	// `EntityIdentity`, which rides it on the avatar. 4px because a ~230px poster
	// edge swallows the 2px an avatar wears.
	const inMedia = $derived(notable && isPoster);
	const ringClass = $derived(inMedia ? `ring-4 ${toneFor(ref.status)?.ring ?? ''}` : '');
</script>

<Card class={className}>
	{#if isPoster}
		<div class="relative">
			<figure class="aspect-[2/3] w-full overflow-hidden bg-base-200">
				{#if poster}
					<img
						src={poster.src}
						srcset={poster.srcset}
						sizes={poster.sizes}
						alt=""
						class="size-full object-cover"
						loading="lazy"
					/>
				{:else}
					<div class="flex size-full items-center justify-center">
						<Icon size={64} class="text-subtle" />
					</div>
				{/if}
			</figure>
			{#if ringClass}
				<!--
					The ring is its own overlay rather than a class on the figure. An
					inset ring is a box-shadow, which paints under the element's content,
					so the poster image covered it completely — and an *outset* ring gets
					clipped by the card's own rounded corners. This sits above both.
				-->
				<div class="pointer-events-none absolute inset-0 {ringClass} ring-inset"></div>
			{/if}
			{#if inMedia && ref.status}
				<span
					class="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-base-100 shadow"
				>
					<StatusBadge status={ref.status} size={22} />
				</span>
			{/if}
		</div>
	{/if}
	<CardBody>
		<!--
			The identity is not re-implemented here. A card's name/avatar/subline is
			the same object a row draws, and drawing it twice is what let the status
			rule drift between them once already.

			On a poster card both the media and the status are off: the artwork above
			*is* this record's image, and repeating it as a squashed avatar under its
			own poster is the one thing a poster card must not do.
		-->
		<EntityIdentity {ref} size="md" heading={3} avatar={!isPoster} status={!isPoster} />

		{#if facts}{@render facts()}{/if}
		{#if children}{@render children()}{/if}
	</CardBody>
	{#if actions}
		<!--
			Riding the bottom edge, half in and half out, the way the reservation
			cards do it: `h-0` takes the row out of the flow and `items-center`
			straddles the buttons across the boundary. Every `.btn` in this app
			already carries the retro hard shadow, so sitting them on the edge is
			what makes them read as raised off the card rather than printed on it.

			Outside `CardBody` on purpose — its 24px padding would inset the buttons
			from the corner, and the point is that they meet it.
		-->
		<div class="mt-5 flex h-0 items-center justify-end gap-2 px-3">
			{@render actions()}
		</div>
	{/if}
</Card>
