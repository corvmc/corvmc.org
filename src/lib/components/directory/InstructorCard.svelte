<script lang="ts">
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc } from '$lib/utils/images';
	import { initials } from '$lib/utils/format';
	import { IconMail, IconPhone, IconExternalLink } from '@tabler/icons-svelte';

	/**
	 * A teacher, on the instructor listing.
	 *
	 * A **sibling** of `IdCard` rather than a mode of it. The two answer different
	 * questions for different readers — `IdCard` answers "who can I play with" for
	 * a member browsing bandmates, this answers "who can teach me" for someone who
	 * found CMC from a search engine and has no account. Different columns, and
	 * bolting a mode onto `IdCard` would give one component two layouts and two
	 * prop sets.
	 *
	 * Two `href`s here trip `svelte/no-navigation-without-resolve` as warnings, the
	 * same way `IdCard` does: the profile link arrives as a prop already resolved
	 * by the page, and `bookingUrl` is an arbitrary external URL the instructor
	 * supplied, which `resolve()` is not for.
	 *
	 * It shares the `poster-gen` pattern and initials treatment so the two still
	 * read as one family. The directory routes are art-directed per
	 * `ui-patterns.md` and deliberately keep their own cards.
	 */
	interface Props {
		href: string;
		name: string;
		image?: string | null;
		pronouns?: string | null;
		headline?: string | null;
		blurb?: string | null;
		ratesNote?: string | null;
		bookingUrl?: string | null;
		instruments?: string[];
		/** Already gated by `contactForView` — null means withheld *or* absent, and this card must not distinguish. */
		contact?: { email?: string; phone?: string; social?: string } | null;
	}

	let {
		href,
		name,
		image,
		pronouns,
		headline,
		blurb,
		ratesNote,
		bookingUrl,
		instruments = [],
		contact = null
	}: Props = $props();

	const patternClass = $derived(`poster-gen--${hashPattern(name)}`);
	const photo = $derived(imageSrc(image, 'avatar-lg'));
	const MAX_TAGS = 4;
	const shownInstruments = $derived(instruments.slice(0, MAX_TAGS));
</script>

<article class="card border border-base-300 bg-base-100">
	<div class="card-body gap-3">
		<div class="flex items-start gap-3">
			<div class="h-16 w-16 shrink-0">
				{#if image}
					<img
						src={photo.src}
						srcset={photo.srcset}
						alt={name}
						class="h-full w-full rounded object-cover"
					/>
				{:else}
					<div
						class="poster-gen {patternClass} flex h-full w-full items-center justify-center rounded"
					>
						<span class="text-lg font-bold">{initials(name)}</span>
					</div>
				{/if}
			</div>

			<div class="min-w-0 flex-1">
				<h3 class="font-semibold">
					<a {href} class="link-hover">{name}</a>
					{#if pronouns}<span class="ml-1 text-subtle text-xs">{pronouns}</span>{/if}
				</h3>
				{#if headline}
					<p class="text-muted text-sm">{headline}</p>
				{/if}
			</div>
		</div>

		{#if instruments.length}
			<div class="flex flex-wrap gap-1">
				{#each shownInstruments as inst (inst)}
					<span class="id-tag id-tag--teal">{inst}</span>
				{/each}
			</div>
		{/if}

		{#if blurb}
			<p class="text-sm whitespace-pre-line">{blurb}</p>
		{/if}

		{#if ratesNote}
			<!-- Free text, never a number CMC could total: lesson money is between
			     the teacher and the student, and CMC does not process it. -->
			<p class="text-subtle text-sm">{ratesNote}</p>
		{/if}

		{#if contact?.email || contact?.phone || bookingUrl}
			<div class="flex flex-wrap items-center gap-3 text-sm">
				{#if contact?.email}
					<a href="mailto:{contact.email}" class="inline-flex items-center gap-1 link-hover">
						<IconMail size={14} />{contact.email}
					</a>
				{/if}
				{#if contact?.phone}
					<a href="tel:{contact.phone}" class="inline-flex items-center gap-1 link-hover">
						<IconPhone size={14} />{contact.phone}
					</a>
				{/if}
				{#if bookingUrl}
					<a
						href={bookingUrl}
						rel="noopener noreferrer nofollow"
						target="_blank"
						class="btn btn-primary btn-sm"
					>
						<IconExternalLink size={14} />Book a lesson
					</a>
				{/if}
			</div>
		{/if}
	</div>
</article>
