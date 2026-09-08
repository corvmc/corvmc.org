<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { IconCheck, IconCircle, IconLock } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import type { EpkSection } from '$lib/server/band/epk-completeness';

	/**
	 * The ladder, as a named destination rather than a percentage.
	 *
	 * `compact` is the dashboard's form — a count and the single next thing. The
	 * full form enumerates every rung, which is the point: LinkedIn's profile
	 * strength works because the target has a name and the missing pieces are
	 * listed, and "68% complete" tells a band nothing it can act on.
	 */
	let {
		slug,
		sections,
		done,
		total,
		next,
		compact = false
	}: {
		slug: string;
		sections: EpkSection[];
		done: number;
		total: number;
		next: EpkSection | null;
		compact?: boolean;
	} = $props();

	const href = (section: EpkSection) => resolve(section.route, { slug });

	const premiumSections = $derived(sections.filter((s) => s.tier === 'premium'));
	const freeSections = $derived(sections.filter((s) => s.tier === 'free'));
</script>

<Card>
	<CardBody>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 class="font-semibold">Press kit</h2>
				<p class="text-muted text-sm">
					{done} of {total} pieces
					{#if next}&middot; next: {next.label}{:else}&middot; ready to send{/if}
				</p>
			</div>
			{#if compact}
				<Button href={href(next ?? sections[0])} variant="default" size="sm" outline>
					{next ? 'Finish it' : 'View'}
				</Button>
			{/if}
		</div>

		<progress class="progress w-full" value={done} max={total} aria-label="Press kit progress"
		></progress>

		{#if !compact}
			<ul class="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
				{#each freeSections as section (section.key)}
					<li class="flex items-start gap-2 py-1 text-sm">
						{#if section.done}
							<IconCheck size={16} class="mt-0.5 shrink-0 text-success" />
							<span>{section.label}</span>
						{:else}
							<IconCircle size={16} class="mt-0.5 shrink-0 opacity-40" />
							<span>
								<a href={href(section)} class="link">{section.label}</a>
								<span class="block text-muted text-xs">{section.hint}</span>
							</span>
						{/if}
					</li>
				{/each}
			</ul>

			<!-- The rungs a band site adds. Absent rather than locked when there are
			     none, because a ladder that simply ends reads better than a teaser. -->
			{#if premiumSections.length > 0}
				<div class="mt-3 border-t pt-3">
					<p class="mb-1 text-muted text-xs">With a band site</p>
					<ul class="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
						{#each premiumSections as section (section.key)}
							<li class="flex items-start gap-2 py-1 text-sm">
								{#if section.done}
									<IconCheck size={16} class="mt-0.5 shrink-0 text-success" />
								{:else}
									<IconLock size={16} class="mt-0.5 shrink-0 opacity-40" />
								{/if}
								<span class:opacity-60={!section.done}>{section.label}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	</CardBody>
</Card>
