<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import {
		getStaffMusicPage,
		withholdReleaseForm,
		restoreReleaseForm,
		setRadioExclusionForm
	} from '$lib/remote/staff-music.remote';
	import { formatCents } from '$lib/utils/format';
	import { resolve } from '$app/paths';
	import { IconRadio } from '@tabler/icons-svelte';

	const { releases, pool, sales, radioEnabled, audioEnabled, now, recent } = $derived(
		await getStaffMusicPage()
	);

	/**
	 * The launch question, as one sentence.
	 *
	 * Deliberately about eligible *tracks* and distinct *bands*, not releases: a
	 * rotation of forty tracks by two bands sounds like two bands, and the number
	 * that would reassure you here ("37 releases") is the one that misleads.
	 */
	const readiness = $derived(
		pool.eligibleTracks === 0
			? 'Nothing is eligible yet.'
			: `${pool.eligibleTracks} tracks from ${pool.bands} ${pool.bands === 1 ? 'band' : 'bands'}.`
	);
</script>

<PageHeader title="Releases" subtitle="Staff" />

<PageContent width="full">
	{#if !audioEnabled}
		<Alert type="info">
			The music storefront is switched off, so bands cannot see or upload anything yet. This page
			works either way — turn it on in
			<a class="link" href={resolve('/staff/settings')}>Settings → Features</a>.
		</Alert>
	{/if}

	<Card>
		<CardBody>
			<CardTitle><IconRadio size={18} /> CMC Radio</CardTitle>

			<div class="grid gap-3 sm:grid-cols-3">
				<StatCard title="Eligible tracks" value={String(pool.eligibleTracks)} />
				<StatCard title="Bands in rotation" value={String(pool.bands)} />
				<StatCard title="Opted-in releases" value={String(pool.optedInReleases)} />
			</div>

			<p class="mt-2 text-muted">{readiness}</p>

			{#if pool.excludedByLength > 0}
				<!-- Bands that opted in and will still never be heard. Without this
				     they have no way to find that out. -->
				<Alert type="warning">
					{pool.excludedByLength}
					{pool.excludedByLength === 1 ? 'track is' : 'tracks are'} opted in but outside the station's
					length limits, so the scheduler skips them.
				</Alert>
			{/if}

			{#if radioEnabled}
				<p>
					<Badge variant="success">On the air</Badge>
					{#if now.current}
						Now playing <strong>{now.current.trackTitle}</strong> — {now.current.bandName}
					{:else}
						Nothing scheduled right now.
					{/if}
				</p>
			{:else}
				<p>
					<Badge variant="ghost">Off</Badge>
					Switch the station on in
					<a class="link" href={resolve('/staff/settings')}>Settings → Features</a> when the pool above
					looks like a station.
				</p>
			{/if}

			{#if recent.length > 0}
				<p class="text-subtle">
					Recently played: {recent
						.slice(0, 6)
						.map((r) => `${r.trackTitle} (${r.bandName})`)
						.join(' · ')}
				</p>
			{/if}
		</CardBody>
	</Card>

	<Card>
		<CardBody>
			<CardTitle>Sales</CardTitle>
			<div class="grid gap-3 sm:grid-cols-5">
				<StatCard title="Sales" value={String(sales.sales)} />
				<StatCard title="Gross" value={formatCents(sales.grossCents)} />
				<StatCard title="To bands" value={formatCents(sales.toBandsCents)} />
				<!-- Card processing comes off the top, funded by both sides in
				     proportion, so it is shown beside them rather than folded into
				     either figure. -->
				<StatCard title="Card fees" value={formatCents(sales.feesCents)} />
				<StatCard title="CMC kept" value={formatCents(sales.toCollectiveCents)} />
			</div>
			<!-- The number the refusable-cut decision has to be judged on. It will
			     not be the suggested 10%, and which way it lands is the open
			     question — so it is reported rather than assumed. -->
			<p class="text-muted">
				Realised take: {(sales.realisedTakeBps / 100).toFixed(1)}% of what buyers paid, after card
				fees.
				{#if sales.freeSales > 0}
					{sales.freeSales} of {sales.sales} were free downloads.
				{/if}
			</p>
		</CardBody>
	</Card>

	<Card>
		<CardBody>
			<CardTitle>Releases</CardTitle>
			{#if releases.length === 0}
				<EmptyState title="No releases yet" description="Bands' records will appear here." />
			{:else}
				<Table>
					{#snippet head()}
						<th>Release</th>
						<th>Band</th>
						<th>Status</th>
						<th>Radio</th>
						<th>Sales</th>
						<th></th>
					{/snippet}
					{#each releases as release (release.id)}
						<tr>
							<td>
								{release.title}
								<span class="text-subtle">· {release.trackCount} tracks</span>
							</td>
							<td>
								<a class="link" href={resolve(`/staff/bands`)}>{release.bandName}</a>
							</td>
							<td>
								{#if release.status === 'published'}
									<Badge size="sm" variant="success">Published</Badge>
								{:else if release.status === 'withheld'}
									<Badge size="sm" variant="error">Withheld</Badge>
								{:else}
									<Badge size="sm" variant="ghost">Draft</Badge>
								{/if}
							</td>
							<td>
								{#if release.radioExcluded}
									<Badge size="sm" variant="warning">Pulled</Badge>
								{:else if release.radioOptIn}
									<Badge size="sm" variant="info">Opted in</Badge>
								{:else}
									<span class="text-subtle">—</span>
								{/if}
							</td>
							<td class="tabular-nums">{release.salesCount}</td>
							<td class="flex flex-wrap gap-1">
								{#if release.status === 'withheld'}
									<Action
										action={restoreReleaseForm.for(release.id)}
										label="Restore"
										variant="ghost"
										size="sm"
										modalTitle="Restore release"
										submitLabel="Restore"
										successToast="Restored"
									>
										{#snippet form()}
											{@const fields = restoreReleaseForm.for(release.id).fields}
											<input {...fields.releaseId.as('hidden', release.id)} />
											<p>
												Hand <strong>{release.title}</strong> back to {release.bandName} as a draft? They
												decide whether to publish it again.
											</p>
										{/snippet}
									</Action>
								{:else}
									<Action
										action={withholdReleaseForm.for(release.id)}
										label="Withhold"
										variant="ghost"
										size="sm"
										submitVariant="error"
										modalTitle="Withhold release"
										submitLabel="Withhold"
										successToast="Withheld"
									>
										{#snippet form()}
											{@const fields = withholdReleaseForm.for(release.id).fields}
											<div class="space-y-3">
												<input {...fields.releaseId.as('hidden', release.id)} />
												<p>
													Take <strong>{release.title}</strong> down. It stops being public and the band
													cannot republish it themselves.
												</p>
												<FormField
													field={fields.reason}
													label="Reason"
													description="The band sees this on their release page — a takedown they can't see the cause of is one they can't fix."
													required
												/>
											</div>
										{/snippet}
									</Action>
								{/if}

								{#if release.radioOptIn}
									<Action
										action={setRadioExclusionForm.for(release.id)}
										label={release.radioExcluded ? 'Put back on air' : 'Pull from radio'}
										variant="ghost"
										size="sm"
										modalTitle={release.radioExcluded ? 'Put back on air' : 'Pull from radio'}
										submitLabel="Save"
										successToast="Rotation updated"
									>
										{#snippet form()}
											{@const fields = setRadioExclusionForm.for(release.id).fields}
											<div class="space-y-3">
												<input {...fields.releaseId.as('hidden', release.id)} />
												<input
													{...fields.excluded.as('checkbox', !release.radioExcluded)}
													type="hidden"
												/>
												{#if release.radioExcluded}
													<p>
														Put <strong>{release.title}</strong> back in the rotation? The band's own
														opt-in still applies.
													</p>
												{:else}
													<p>
														Take <strong>{release.title}</strong> off the air without unpublishing it.
													</p>
													<FormField field={fields.reason} label="Reason (shown to the band)" />
												{/if}
											</div>
										{/snippet}
									</Action>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</CardBody>
	</Card>
</PageContent>
