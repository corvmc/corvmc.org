<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import * as env from '$app/env/public';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import AddressCard from '#lib/components/ui/AddressCard.svelte';
	import PressKitProgress from '#lib/components/band/PressKitProgress.svelte';
	import { canonicalAddress } from '#lib/utils/canonical-address.js';
	import { formatDate, relativeDay } from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { getBandDashboard } from '#lib/remote/band-dashboard.remote.js';
	import { getBandLayoutContext } from './layout-context';
	import SetupSteps from './SetupSteps.svelte';

	// The layout already holds this; see `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	const band = $derived(layout.band);
	const now = new Date();

	// The address the band hands out. Below the work rather than leading (#3128).
	const address = $derived(
		canonicalAddress({ kind: 'group', slug: band.slug }, { siteUrl: env.PUBLIC_SITE_URL })
	);

	// The page's one load-bearing query: to-dos, the schedule, setup and the press kit.
	const dashboard = $derived(await getBandDashboard(band.id));
</script>

<PageHeader title={m.band_slug_dashboard_title()} subtitle={band.name} />
<PageContent>
	<!-- What the band owes or has to answer, first; absent when there is none. -->
	{#if dashboard.todos.length > 0}
		<InfoCard
			title={m.band_slug_pending_actions_title()}
			state={dashboard.todos.length}
			testid="band-todos"
		>
			<ul class="flex flex-col divide-y divide-base-300">
				{#each dashboard.todos as item (item.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
						data-kind={item.kind}
					>
						<div class="min-w-0">
							<p class="font-medium">{item.title}</p>
							{#if item.detail}
								<p class="text-subtle text-sm">{item.detail}</p>
							{/if}
						</div>
						<div class="flex w-max items-center gap-3">
							{#if item.dueAt}
								<span class="text-sm whitespace-nowrap" class:text-error={item.dueAt < now}>
									{relativeDay(item.dueAt)}
								</span>
							{/if}
							<Button href={item.href} size="sm">{item.label}</Button>
						</div>
					</li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	<InfoCard title={m.band_slug_upcoming_title()} testid="band-upcoming">
		{#snippet action()}
			<div class="flex gap-3 text-sm">
				<a
					href={resolve('/band/[slug]/reservations', { slug: band.slug })}
					class="link link-primary">{m.band_slug_all_reservations_text()}</a
				>
				<a href={resolve('/band/[slug]/events', { slug: band.slug })} class="link link-primary"
					>{m.band_slug_all_events_text()}</a
				>
			</div>
		{/snippet}

		{#if dashboard.upcoming.length === 0}
			<EmptyState title={m.band_slug_upcoming_empty_title()} />
		{:else}
			<ul class="flex flex-col divide-y divide-base-300">
				{#each dashboard.upcoming as row (row.id)}
					<li class="py-2 first:pt-0 last:pb-0" data-kind={row.kind}>
						<a href={row.href} class="flex items-center justify-between gap-3 hover:underline">
							<div class="min-w-0">
								<p class="truncate font-medium">
									{row.title ?? m.band_slug_reservation_text()}
								</p>
								<p class="text-subtle text-sm">
									{formatDate(row.startsAt)} · {formatEventTimeRange(row.startsAt, row.endsAt)}
								</p>
							</div>
							<StatusBadge status={row.status} label />
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</InfoCard>

	{#if dashboard.setup}
		<SetupSteps steps={dashboard.setup} />
	{:else if dashboard.pressKit}
		<PressKitProgress
			slug={band.slug}
			sections={dashboard.pressKit.sections}
			done={dashboard.pressKit.done}
			total={dashboard.pressKit.total}
			next={dashboard.pressKit.next}
			compact
		/>
	{/if}

	{#if address}
		<AddressCard url={address} title={m.band_slug_band_s_address_title()}>
			{m.band_slug_address_card_text()}
		</AddressCard>
	{/if}
</PageContent>
