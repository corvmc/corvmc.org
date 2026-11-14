<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import StatGrid from '#lib/components/ui/StatGrid.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { urlState, oneOf, text } from '#lib/urlState.svelte.js';
	import { getStaffMusicPage } from '#lib/remote/staff-music.remote.js';
	import { resolve } from '$app/paths';
	import { IconRadio } from '@tabler/icons-svelte';
	import ReleasePanel from './ReleasePanel.svelte';
	import ReleaseStatus from './ReleaseStatus.svelte';
	import RadioStatus from './RadioStatus.svelte';

	/**
	 * Music (#2766): the radio's state, then every release in one table. A row
	 * opens its release beside the list, with the takedown, radio and refund
	 * controls. Sales totals are the Music report.
	 */
	const filters = urlState(resolve('staff/music'), {
		status: oneOf(['', 'published', 'withheld', 'draft'] as const, ''),
		release: text()
	});

	const { releases, pool, radioEnabled, audioEnabled, now, recent, canModerate } = $derived(
		await getStaffMusicPage()
	);

	const shown = $derived(
		filters.status ? releases.filter((r) => r.status === filters.status) : releases
	);
	const open = $derived(releases.find((r) => r.id === filters.release));

	/**
	 * The launch question, as one sentence.
	 *
	 * Deliberately about eligible *tracks* and distinct *bands*, not releases: a
	 * rotation of forty tracks by two bands sounds like two bands, and the number
	 * that would reassure you here ("37 releases") is the one that misleads.
	 */
	const readiness = $derived(
		pool.eligibleTracks === 0
			? m.staff_music_readiness_text()
			: m.staff_music_tracks_from_bands_text({
					eligibleTracks: pool.eligibleTracks,
					bands: pool.bands
				})
	);
</script>

<PageHeader title={m.staff_music_title()} />

<PageContent width="full">
	{#if !audioEnabled}
		<Alert type="info">
			<ParaglideMessage
				message={m.staff_music_music_storefront_switched_off_so_body}
				inputs={{ staff_music_settings_features: m.staff_music_settings_features_body() }}
				>{#snippet a({ children })}<a class="link" href={resolve('staff/system/features')}
						>{@render children?.()}</a
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	<Card>
		<CardBody>
			<CardTitle><IconRadio size={18} /> {m.staff_music_cmc_radio_title()}</CardTitle>

			<StatGrid cols={3}>
				<StatCard
					title={m.staff_music_eligible_tracks_title()}
					value={String(pool.eligibleTracks)}
				/>
				<StatCard title={m.staff_music_bands_rotation_title()} value={String(pool.bands)} />
				<StatCard
					title={m.staff_music_opted_releases_title()}
					value={String(pool.optedInReleases)}
				/>
			</StatGrid>

			<p class="mt-2 text-muted">{readiness}</p>

			{#if pool.excludedByLength > 0}
				<!-- Bands that opted in and will still never be heard. Without this
				     they have no way to find that out. -->
				<Alert type="warning">
					{m.staff_music_tracks_opted_but_outside_station_body({
						excludedByLength: pool.excludedByLength
					})}
				</Alert>
			{/if}

			{#if radioEnabled}
				<p>
					<Badge variant="success">{m.staff_music_air_label()}</Badge>
					{#if now.current}
						<ParaglideMessage
							message={m.staff_music_now_playing_text}
							inputs={{ trackTitle: now.current.trackTitle, bandName: now.current.bandName }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					{:else}
						{m.staff_music_nothing_scheduled_right_now_text()}
					{/if}
				</p>
			{:else}
				<p>
					<Badge variant="ghost">{m.staff_music_off_label()}</Badge>
					<ParaglideMessage
						message={m.staff_music_switch_station_when_pool_above_text}
						inputs={{ staff_music_settings_features: m.staff_music_settings_features_text() }}
						>{#snippet a({ children })}<a class="link" href={resolve('staff/system/features')}
								>{@render children?.()}</a
							>{/snippet}</ParaglideMessage
					>
				</p>
			{/if}

			{#if recent.length > 0}
				<p class="text-subtle">
					{m.staff_music_recently_played_text({
						join: recent
							.slice(0, 6)
							.map((r) => `${r.trackTitle} (${r.bandName})`)
							.join(' · ')
					})}
				</p>
			{/if}
		</CardBody>
	</Card>

	<FilterBar activeCount={filters.status ? 1 : 0} onclear={() => (filters.status = '')}>
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={filters.status}
			onchange={(e: Event) =>
				(filters.status = (e.currentTarget as HTMLSelectElement).value as typeof filters.status)}
		>
			<option value="">{m.ui_list_filters_all_statuses_label()}</option>
			<option value="published">{m.staff_published_label()}</option>
			<option value="withheld">{m.staff_music_withheld_label()}</option>
			<option value="draft">{m.staff_draft_label()}</option>
		</Select>
	</FilterBar>

	{#if shown.length === 0}
		<EmptyState
			title={m.staff_music_no_releases_yet_title()}
			description={m.staff_music_bands_records_will_appear_here_body()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
				<th>{m.staff_music_release_label()}</th>
				<th class="col-support">{m.staff_band_label()}</th>
				<th>{m.staff_music_radio_label()}</th>
				<th class="cell-num">{m.staff_music_sales_label()}</th>
			{/snippet}
			{#each shown as release (release.id)}
				<tr class="hover" aria-current={release.id === filters.release ? 'true' : undefined}>
					<td class="w-px"><ReleaseStatus status={release.status} /></td>
					<td class="cell-primary">
						<button
							type="button"
							class="text-left font-medium hover:underline"
							onclick={() => (filters.release = release.id)}>{release.title}</button
						>
						<span class="text-subtle"
							>{m.staff_music_tracks_text({ trackCount: release.trackCount })}</span
						>
					</td>
					<td class="col-support">{release.bandName}</td>
					<td><RadioStatus {release} /></td>
					<td class="cell-num tabular-nums">{release.salesCount}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>

{#if open}
	{#key open.id}
		<ReleasePanel release={open} {canModerate} onclose={() => (filters.release = '')} />
	{/key}
{/if}
