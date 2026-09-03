<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { releaseKindLabels, type ReleaseKind } from '$lib/config';
	import { formatTrackSummary } from '$lib/utils/audio';
	import { formatDateYear, formatDollars } from '$lib/utils/format';
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
				<div class="flex flex-wrap items-center gap-2">
					<span class="truncate font-medium">{release.title}</span>
					<Badge size="sm">{releaseKindLabels[release.kind]}</Badge>
					{#if release.status === 'draft'}
						<Badge size="sm" variant="ghost">Draft</Badge>
					{:else if release.status === 'withheld'}
						<Badge size="sm" variant="error">Withheld</Badge>
					{/if}
					{#if release.radioOptIn && !release.radioExcluded}
						<Badge size="sm" variant="info">
							<IconRadio size={12} /> Radio
						</Badge>
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
					<p class="text-warning">
						Pulled from the radio{release.radioExcludedReason
							? ` — ${release.radioExcludedReason}`
							: ''}
					</p>
				{/if}
			</div>

			<div class="text-right">
				<p class="font-medium">
					{release.priceMinCents === 0 ? 'Free' : formatDollars(release.priceMinCents)}
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
