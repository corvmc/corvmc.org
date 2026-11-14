<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import {
		getStaffMusicPage,
		getStaffReleaseSales,
		withholdReleaseForm,
		restoreReleaseForm,
		setRadioExclusionForm,
		refundPurchaseForm
	} from '#lib/remote/staff-music.remote.js';
	import { errorMessage } from '#lib/error-message.js';
	import { Latest } from '#lib/latest.svelte.js';
	import { formatCents, formatDate } from '#lib/utils/format.js';
	import ReleaseStatus from './ReleaseStatus.svelte';
	import RadioStatus from './RadioStatus.svelte';

	type Release = Awaited<ReturnType<typeof getStaffMusicPage>>['releases'][number];

	/**
	 * One release beside the list (#2766): its status, its takedown and radio
	 * controls, and its recent sales with the refund. Sales are capped rather
	 * than paged: a refund request is about a recent purchase.
	 */
	let {
		release,
		canModerate,
		onclose
	}: { release: Release; canModerate: boolean; onclose: () => void } = $props();

	let open = $state(true);
	// Latched rather than awaited, so a refund's refresh keeps its dialog mounted.
	const sales = new Latest(() => getStaffReleaseSales(release.id));
</script>

<Modal bind:open title={release.title} placement="end" {onclose}>
	<div class="space-y-4">
		<p class="text-muted">
			{release.bandName}
			{m.staff_music_tracks_text({ trackCount: release.trackCount })}
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<ReleaseStatus status={release.status} />
			<RadioStatus {release} />
		</div>

		<div class="flex flex-wrap gap-1">
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
								<input {...fields.excluded.as('checkbox', !release.radioExcluded)} type="hidden" />
								{#if release.radioExcluded}
									<p>
										<ParaglideMessage
											message={m.staff_music_put_back_rotation_band_s_text}
											inputs={{ title: release.title }}
											>{#snippet strong({ children })}<strong>{@render children?.()}</strong
												>{/snippet}</ParaglideMessage
										>
									</p>
								{:else}
									<p>
										<ParaglideMessage
											message={m.staff_music_take_off_air_without_unpublishing_text}
											inputs={{ title: release.title }}
											>{#snippet strong({ children })}<strong>{@render children?.()}</strong
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
		</div>

		<section class="space-y-2" aria-labelledby="release-sales-title">
			<h3 id="release-sales-title" class="font-semibold">{m.staff_music_recent_sales_title()}</h3>
			{#if sales.error}
				<Alert type="warning" reset={() => getStaffReleaseSales(release.id).refresh()}>
					{errorMessage(sales.error.e)}
				</Alert>
			{:else if !sales.current}
				<span class="loading loading-md loading-spinner"></span>
			{:else}
				{@const { purchases, canRefund } = sales.current}
				{#if purchases.length === 0}
					<EmptyState
						title={m.staff_music_no_sales_yet_title()}
						description={m.staff_music_purchases_show_up_here_as_body()}
					/>
				{:else}
					<Table>
						{#snippet head()}
							<th>{m.staff_music_buyer_label()}</th>
							<th class="col-support">{m.staff_when_label()}</th>
							<th>{m.staff_paid_label()}</th>
							<th class="col-extra">{m.staff_music_band_label()}</th>
							<th>{m.staff_status_label()}</th>
							<th></th>
						{/snippet}

						{#each purchases as purchase (purchase.purchaseId)}
							<tr>
								<td>{purchase.buyerEmail}</td>
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
											onsuccess={() => void getStaffReleaseSales(release.id).refresh()}
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
																>{#snippet strong({ children })}<strong
																		>{@render children?.()}</strong
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
																>{#snippet strong({ children })}<strong
																		>{@render children?.()}</strong
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
			{/if}
		</section>
	</div>
</Modal>
