<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import {
		getStaffMusicPage,
		withholdReleaseForm,
		restoreReleaseForm,
		setRadioExclusionForm,
		refundPurchaseForm
	} from '#lib/remote/staff-music.remote.js';
	import { formatCents, formatDate } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { IconRadio } from '@tabler/icons-svelte';

	const {
		releases,
		pool,
		sales,
		purchases,
		radioEnabled,
		audioEnabled,
		now,
		recent,
		canModerate,
		canRefund
	} = $derived(await getStaffMusicPage());

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

<PageHeader title={m.staff_music_releases_title()} subtitle={m.staff_staff_body()} />

<PageContent width="full">
	{#if !audioEnabled}
		<Alert type="info">
			<ParaglideMessage
				message={m.staff_music_music_storefront_switched_off_so_body}
				inputs={{ staff_music_settings_features: m.staff_music_settings_features_body() }}
				>{#snippet a({ children })}<a class="link" href={resolve('staff/settings')}
						>{@render children?.()}</a
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	<Card>
		<CardBody>
			<CardTitle><IconRadio size={18} /> {m.staff_music_cmc_radio_title()}</CardTitle>

			<div class="grid gap-3 sm:grid-cols-3">
				<StatCard
					title={m.staff_music_eligible_tracks_title()}
					value={String(pool.eligibleTracks)}
				/>
				<StatCard title={m.staff_music_bands_rotation_title()} value={String(pool.bands)} />
				<StatCard
					title={m.staff_music_opted_releases_title()}
					value={String(pool.optedInReleases)}
				/>
			</div>

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
						>{#snippet a({ children })}<a class="link" href={resolve('staff/settings')}
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

	<Card>
		<CardBody>
			<CardTitle>{m.staff_music_sales_title()}</CardTitle>
			<div class="grid gap-3 sm:grid-cols-5">
				<StatCard title={m.staff_music_sales_title()} value={String(sales.sales)} />
				<StatCard title={m.staff_music_gross_title()} value={formatCents(sales.grossCents)} />
				<StatCard title={m.staff_music_bands_title()} value={formatCents(sales.toBandsCents)} />
				<!-- Card processing comes off the top, funded by both sides in
				     proportion, so it is shown beside them rather than folded into
				     either figure. -->
				<StatCard title={m.staff_music_card_fees_title()} value={formatCents(sales.feesCents)} />
				<StatCard
					title={m.staff_music_cmc_kept_title()}
					value={formatCents(sales.toCollectiveCents)}
				/>
			</div>
			<!-- The number the refusable-cut decision has to be judged on. It will
			     not be the suggested 10%, and which way it lands is the open
			     question — so it is reported rather than assumed. -->
			<p class="text-muted">
				{m.staff_music_realised_take_what_buyers_paid_text({
					toFixed: (sales.realisedTakeBps / 100).toFixed(1)
				})}
				{#if sales.freeSales > 0}
					{m.staff_music_were_free_downloads_text({
						freeSales: sales.freeSales,
						sales: sales.sales
					})}
				{/if}
			</p>
		</CardBody>
	</Card>

	<Card>
		<CardBody>
			<CardTitle>{m.staff_music_releases_title()}</CardTitle>
			{#if releases.length === 0}
				<EmptyState
					title={m.staff_music_no_releases_yet_title()}
					description={m.staff_music_bands_records_will_appear_here_body()}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th>{m.staff_music_release_label()}</th>
						<th>{m.staff_band_label()}</th>
						<th>{m.staff_status_label()}</th>
						<th>{m.staff_music_radio_label()}</th>
						<th>{m.staff_music_sales_label()}</th>
						<th></th>
					{/snippet}
					{#each releases as release (release.id)}
						<tr>
							<td>
								{release.title}
								<span class="text-subtle"
									>{m.staff_music_tracks_text({ trackCount: release.trackCount })}</span
								>
							</td>
							<td>
								<a class="link" href={resolve('staff/groups/bands')}>{release.bandName}</a>
							</td>
							<td>
								{#if release.status === 'published'}
									<Badge size="sm" variant="success">{m.staff_published_label()}</Badge>
								{:else if release.status === 'withheld'}
									<Badge size="sm" variant="error">{m.staff_music_withheld_label()}</Badge>
								{:else}
									<Badge size="sm" variant="ghost">{m.staff_draft_label()}</Badge>
								{/if}
							</td>
							<td>
								{#if release.radioExcluded}
									<Badge size="sm" variant="warning">{m.staff_music_pulled_label()}</Badge>
								{:else if release.radioOptIn && release.radioAttested}
									<Badge size="sm" variant="info">{m.staff_music_opted_label()}</Badge>
								{:else if release.radioOptIn}
									<Badge size="sm" variant="warning">{m.staff_music_not_attested_label()}</Badge>
								{:else}
									<span class="text-subtle">—</span>
								{/if}
							</td>
							<td class="tabular-nums">{release.salesCount}</td>
							<td class="flex flex-wrap gap-1">
								{#if canModerate}
									{#if release.status === 'withheld'}
										<Action
											action={restoreReleaseForm.for(release.id)}
											label={m.staff_restore_label()}
											variant="ghost"
											size="sm"
											modalTitle={m.staff_music_restore_release_title()}
											submitLabel={m.staff_restore_label()}
											successToast={m.staff_restored_toast()}
										>
											{#snippet form()}
												{@const fields = restoreReleaseForm.for(release.id).fields}
												<input {...fields.releaseId.as('hidden', release.id)} />
												<p>
													<ParaglideMessage
														message={m.staff_music_hand_back_as_draft_they_text}
														inputs={{ title: release.title, bandName: release.bandName }}
														>{#snippet strong({ children })}<strong>{@render children?.()}</strong
															>{/snippet}</ParaglideMessage
													>
												</p>
											{/snippet}
										</Action>
									{:else}
										<Action
											action={withholdReleaseForm.for(release.id)}
											label={m.staff_music_withhold_label()}
											variant="ghost"
											size="sm"
											submitVariant="error"
											modalTitle={m.staff_music_withhold_release_title()}
											submitLabel={m.staff_music_withhold_label()}
											successToast={m.staff_music_withheld_toast()}
										>
											{#snippet form()}
												{@const fields = withholdReleaseForm.for(release.id).fields}
												<div class="space-y-3">
													<input {...fields.releaseId.as('hidden', release.id)} />
													<p>
														<ParaglideMessage
															message={m.staff_music_take_down_stops_being_public_text}
															inputs={{ title: release.title }}
															>{#snippet strong({ children })}<strong>{@render children?.()}</strong
																>{/snippet}</ParaglideMessage
														>
													</p>
													<FormField
														field={fields.reason}
														label={m.staff_reason_label()}
														description={m.staff_music_band_sees_their_release_page_body()}
														required
													/>
												</div>
											{/snippet}
										</Action>
									{/if}

									{#if release.radioOptIn}
										<Action
											action={setRadioExclusionForm.for(release.id)}
											label={release.radioExcluded
												? m.staff_music_put_back_air_label()
												: m.staff_music_pull_from_radio_label()}
											variant="ghost"
											size="sm"
											modalTitle={release.radioExcluded
												? m.staff_music_put_back_air_title()
												: m.staff_music_pull_from_radio_title()}
											submitLabel={m.staff_save_label()}
											successToast={m.staff_music_rotation_updated_toast()}
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
															<ParaglideMessage
																message={m.staff_music_put_back_rotation_band_s_text}
																inputs={{ title: release.title }}
																>{#snippet strong({ children })}<strong
																		>{@render children?.()}</strong
																	>{/snippet}</ParaglideMessage
															>
														</p>
													{:else}
														<p>
															<ParaglideMessage
																message={m.staff_music_take_off_air_without_unpublishing_text}
																inputs={{ title: release.title }}
																>{#snippet strong({ children })}<strong
																		>{@render children?.()}</strong
																	>{/snippet}</ParaglideMessage
															>
														</p>
														<FormField
															field={fields.reason}
															label={m.staff_music_reason_shown_band_label()}
														/>
													{/if}
												</div>
											{/snippet}
										</Action>
									{/if}
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</CardBody>
	</Card>

	<!--
		Sales, one row at a time.

		The totals above answer "is the cut working"; this answers "somebody
		emailed asking for their money back", which is the only question that ends
		in an action. Capped at the recent ones deliberately — a refund request is
		always about a recent purchase, and anything older is a Stripe dashboard
		job.
	-->
	<Card>
		<CardBody>
			<CardTitle>{m.staff_music_recent_sales_title()}</CardTitle>
			{#if purchases.length === 0}
				<EmptyState
					title={m.staff_music_no_sales_yet_title()}
					description={m.staff_music_purchases_show_up_here_as_body()}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th>{m.staff_music_release_label()}</th>
						<th class="col-support">{m.staff_music_buyer_label()}</th>
						<th class="col-support">{m.staff_when_label()}</th>
						<th>{m.staff_paid_label()}</th>
						<th class="col-extra">{m.staff_music_band_label()}</th>
						<th>{m.staff_status_label()}</th>
						<th></th>
					{/snippet}

					{#each purchases as purchase (purchase.purchaseId)}
						<tr>
							<td>
								<span class="font-medium">{purchase.releaseTitle}</span>
								<span class="text-muted">— {purchase.bandName}</span>
							</td>
							<td class="col-support">{purchase.buyerEmail}</td>
							<td class="col-support">
								{purchase.paidAt ? formatDate(purchase.paidAt) : '—'}
							</td>
							<td>
								{purchase.amountPaidCents === 0
									? m.staff_music_free_text()
									: formatCents(purchase.amountPaidCents)}
							</td>
							<td class="col-extra">{formatCents(purchase.bandNetCents)}</td>
							<td>
								{#if purchase.status === 'refunded'}
									<Badge variant="warning">
										{m.staff_music_refunded_label({
											value: purchase.refundedAt ? ` ${formatDate(purchase.refundedAt)}` : ''
										})}
									</Badge>
								{:else if purchase.status === 'pending'}
									<!-- Shown rather than hidden: an abandoned checkout and a lost
									     webhook look identical from the outside, and staff
									     answering "did my payment go through" need to see both. -->
									<Badge variant="ghost">{m.staff_pending_label()}</Badge>
								{:else}
									<Badge variant="success">{m.staff_paid_label()}</Badge>
								{/if}
							</td>
							<td class="text-right">
								{#if canRefund && purchase.refundable}
									<Action
										action={refundPurchaseForm.for(purchase.purchaseId)}
										label={m.staff_music_refund_label()}
										variant="ghost"
										size="sm"
										submitVariant="error"
										modalTitle={m.staff_music_refund_purchase_title()}
										submitLabel={m.staff_music_refund_label()}
										successToast={m.staff_refunded_toast()}
									>
										{#snippet form()}
											{@const fields = refundPurchaseForm.for(purchase.purchaseId).fields}
											<div class="space-y-3">
												<input {...fields.purchaseId.as('hidden', purchase.purchaseId)} />
												{#if purchase.amountPaidCents === 0}
													<p>
														<ParaglideMessage
															message={m.staff_music_revoke_s_download_nothing_was_text}
															inputs={{
																buyerEmail: purchase.buyerEmail,
																releaseTitle: purchase.releaseTitle
															}}
															>{#snippet strong({ children })}<strong>{@render children?.()}</strong
																>{/snippet}</ParaglideMessage
														>
													</p>
												{:else}
													<p>
														<ParaglideMessage
															message={m.staff_music_return_text}
															inputs={{
																formatCents: formatCents(purchase.amountPaidCents),
																buyerEmail: purchase.buyerEmail,
																releaseTitle: purchase.releaseTitle
															}}
															>{#snippet strong({ children })}<strong>{@render children?.()}</strong
																>{/snippet}</ParaglideMessage
														>
													</p>
													<!-- The part that is not obvious from the button: this
													     takes money back out of the band's account, not just
													     the collective's. -->
													<p class="text-muted">
														{m.staff_music_comes_back_out_s_stripe_text({
															formatCents: formatCents(purchase.bandNetCents),
															bandName: purchase.bandName,
															formatCents2: formatCents(purchase.platformFeeCents)
														})}
													</p>
													<p class="text-muted">
														{m.staff_music_their_download_link_stops_working_text()}
													</p>
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
