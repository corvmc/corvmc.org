<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { releaseKindLabels, type ReleaseKind } from '$lib/config';
	import { formatTrackSummary } from '$lib/utils/audio';
	import { formatDateYear, formatCents } from '$lib/utils/format';
	import { IconDisc, IconRadio } from '@tabler/icons-svelte';

	/**
	 * One row of a band's discography.
	 *
	 * Its own component rather than a block in the page because it is a card with
	 * five independent pieces of state — cover or fallback, kind, publication,
	 * radio standing, price — and inline it was six utility classes on the link
	 * alone before any of that. `custom/no-utility-soup` flagged exactly that,
	 * and it was right: this is a component, not a class list.
	 */
	let {
		release,
		href
	}: {
		release: {
			title: string;
			kind: ReleaseKind;
			status: string;
			coverUrl: string | null;
			trackCount: number;
			durationMs: number;
			releasedAt: Date | null;
			priceMinCents: number;
			allowPayMore: boolean;
			radioOptIn: boolean;
			radioAttested: boolean;
			radioExcluded: boolean;
			radioExcludedReason: string | null;
			salesCount: number;
		};
		/**
		 * `ResolvedPathname`, not `string`: `svelte/no-navigation-without-resolve`
		 * has no way to see that the caller already ran `resolve()`, and a bare
		 * string prop is exactly the hole that rule exists to close. Same shape
		 * `EmptyState` uses for its `actionHref`.
		 */
		href: ResolvedPathname;
	} = $props();
</script>

<a {href} class="block">
	<Card class="transition-colors hover:bg-base-200">
		<CardBody row class="items-center gap-4">
			{#if release.coverUrl}
				<img src={release.coverUrl} alt="" class="size-16 shrink-0 rounded object-cover" />
			{:else}
				<div class="grid size-16 shrink-0 place-items-center rounded bg-base-200 text-subtle">
					<IconDisc size={24} />
				</div>
			{/if}

			<div class="min-w-0 flex-1">
				<!-- The title is the row's subject and gets its own line: sharing a
				     wrapping flex row with up to three badges, it was pushed onto a
				     second line whenever the badges filled the first (#1049). -->
				<p class="truncate text-base font-semibold">{release.title}</p>
				<div class="flex flex-wrap items-center gap-2">
					<Badge size="sm">{releaseKindLabels[release.kind]}</Badge>
					{#if release.status === 'draft'}
						<Badge size="sm" variant="ghost">Draft</Badge>
					{:else if release.status === 'withheld'}
						<Badge size="sm" variant="error">Withheld</Badge>
					{/if}
					{#if release.radioOptIn && !release.radioExcluded}
						{#if release.radioAttested}
							<Badge size="sm" variant="info">
								<IconRadio size={12} /> Radio
							</Badge>
						{:else}
							<Badge size="sm" variant="warning">
								<IconRadio size={12} /> Needs attestation
							</Badge>
						{/if}
					{/if}
				</div>

				<p class="text-muted">
					{formatTrackSummary(release.trackCount, release.durationMs)}
					{#if release.releasedAt}
						· {formatDateYear(release.releasedAt)}
					{/if}
				</p>

				<!-- The veto's reason belongs on the list, not only on the detail page:
				     a band that cannot see why a record was pulled has no way to fix it,
				     and this is where they will look. -->
				{#if release.radioExcluded}
					<p class="line-clamp-2 text-warning">
						Pulled from the radio{release.radioExcludedReason
							? ` — ${release.radioExcludedReason}`
							: ''}
					</p>
				{/if}
			</div>

			<!-- Not `font-medium`: at the title's weight, and isolated in its own
			     column, the price won the eye over the release's name (#1049). -->
			<div class="shrink-0 text-right">
				<p>
					{release.priceMinCents === 0 ? 'Free' : formatCents(release.priceMinCents)}
					{#if release.priceMinCents > 0 && release.allowPayMore}
						<span class="text-muted">or more</span>
					{/if}
				</p>
				{#if release.salesCount > 0}
					<p class="text-muted">
						{release.salesCount}
						{release.salesCount === 1 ? 'sale' : 'sales'}
					</p>
				{/if}
			</div>
		</CardBody>
	</Card>
</a>
