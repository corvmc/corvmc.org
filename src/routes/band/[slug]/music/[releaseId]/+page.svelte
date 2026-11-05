<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatCents, formatDate } from '#lib/utils/format.js';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import FileUpload from '#lib/components/ui/Form/FileUpload.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import TrackList from '#lib/components/audio/TrackList.svelte';
	import TrackUploader from './TrackUploader.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { IconDisc } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import { responseErrorMessage } from '#lib/api.js';
	import { errorMessage } from '#lib/error-message.js';
	import {
		getBandRelease,
		getBandMusicPage,
		updateReleaseForm,
		setRadioOptInForm,
		publishReleaseForm,
		unpublishReleaseForm,
		updatePricingForm,
		deleteReleaseForm,
		renameTrackForm,
		deleteTrackForm
	} from '#lib/remote/audio.remote.js';
	import { getBandLayoutContext } from '../../layout-context';
	import {
		releaseKinds,
		releaseKindLabels,
		RADIO_MIN_TRACK_MS,
		RADIO_MAX_TRACK_MS,
		RADIO_PRO_ATTESTATION
	} from '#lib/config.js';
	import { formatTrackSummary, formatRuntime } from '#lib/utils/audio.js';
	import { toLocalDate } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { IconPencil, IconRadio, IconTrash } from '@tabler/icons-svelte';

	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	const band = $derived(layout.band);

	const slug = $derived(page.params.slug!);
	const releaseId = $derived(page.params.releaseId!);

	const { release, tracks, canManage, canSell } = $derived(
		await getBandRelease({ slug, releaseId })
	);

	const kindOptions = releaseKinds.map((kind) => ({
		value: kind,
		label: releaseKindLabels[kind]
	}));

	const totalMs = $derived(tracks.reduce((sum, t) => sum + t.durationMs, 0));

	/**
	 * Which tracks the station will skip even though the record is opted in.
	 *
	 * Surfaced here rather than left to be discovered by never hearing yourself
	 * on the radio. The bounds are the scheduler's, not this page's — a 40-minute
	 * live set would otherwise hold the stream for 40 minutes.
	 */
	const outOfRange = $derived(
		tracks.filter((t) => t.durationMs < RADIO_MIN_TRACK_MS || t.durationMs > RADIO_MAX_TRACK_MS)
	);

	const editFields = updateReleaseForm.fields;

	async function handleCoverUpload(file: File) {
		const body = new FormData();
		body.append('cover', file);
		const res = await fetch(`/api/releases/${releaseId}/cover`, { method: 'POST', body });
		if (!res.ok) throw new Error(await responseErrorMessage(res, 'Upload failed'));
		toast.success(m.band_slug_music_release_id_cover_updated());
		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
	}

	async function removeCover() {
		try {
			const res = await fetch(`/api/releases/${releaseId}/cover`, { method: 'DELETE' });
			if (!res.ok) throw new Error(await responseErrorMessage(res, 'Remove failed'));
			toast.success(m.band_slug_music_release_id_cover_removed());
			void getBandRelease({ slug, releaseId }).refresh();
			void getBandMusicPage(slug).refresh();
		} catch (err) {
			toast.error(errorMessage(err, 'Failed to remove the cover'));
		}
	}
</script>

<PageHeader width="2xl" title={release.title} subtitle={band.name}>
	<Badge>{releaseKindLabels[release.kind]}</Badge>
	{#if release.status === 'draft'}
		<Badge variant="ghost">{m.band_draft()}</Badge>
	{:else if release.status === 'published'}
		<Badge variant="success">{m.band_slug_music_release_id_published()}</Badge>
	{:else}
		<Badge variant="error">{m.band_withheld()}</Badge>
	{/if}
</PageHeader>

<PageContent width="2xl">
	{#if release.status === 'withheld'}
		<Alert type="error">
			{m.band_slug_music_release_id_cmc_staff_withheld_release_not({
				value: release.radioExcludedReason ? ` — ${release.radioExcludedReason}` : ''
			})}
		</Alert>
	{/if}

	<!--
		What the record *is*, for everyone. Every card below is gated on
		`canManage` with no read-only fallback, so a plain band member — a member
		of the band whose release this is — saw a one-card page and had to read
		the price and the date off the list they came from (#1071).
	-->
	{#if !canManage}
		<Card>
			<CardBody row>
				{#if release.coverUrl}
					<img src={release.coverUrl} alt="" class="size-20 shrink-0 rounded object-cover" />
				{/if}
				<DefinitionList class="grow">
					<Fact label={m.band_slug_music_release_id_price()}>
						{release.priceMinCents > 0 ? formatCents(release.priceMinCents) : m.band_free()}
					</Fact>
					{#if release.releasedAt}
						<Fact label={m.band_slug_music_release_id_released()}
							>{formatDate(release.releasedAt)}</Fact
						>
					{/if}
					<Fact label={m.band_slug_music_release_id_sold()}>{release.salesCount}</Fact>
					<Fact label={m.band_slug_music_release_id_cmc_radio()}>
						{#if release.radioExcluded}
							{m.band_slug_music_release_id_pulled_by_staff()}
						{:else}
							{release.radioOptIn
								? release.radioAttested
									? m.band_slug_music_release_id_rotation()
									: m.band_slug_music_release_id_waiting_attestation()
								: m.band_slug_music_release_id_not_rotation()}
						{/if}
					</Fact>
				</DefinitionList>
			</CardBody>
		</Card>

		{#if release.description}
			<p class="text-muted">{release.description}</p>
		{/if}
	{/if}

	<!-- Tracks first. Everything else on this page is a decision about a record
	     that does not exist until it has some. -->
	<Card>
		<CardBody>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<CardTitle>{m.band_slug_music_release_id_tracks()}</CardTitle>
					<p class="text-muted">{formatTrackSummary(tracks.length, totalMs)}</p>
				</div>
				{#if canManage}
					<TrackUploader
						bandId={band.id}
						{releaseId}
						onuploaded={() => {
							void getBandRelease({ slug, releaseId }).refresh();
							void getBandMusicPage(slug).refresh();
						}}
					/>
				{/if}
			</div>

			<TrackList {tracks} empty={m.band_slug_music_release_id_empty()}>
				{#snippet rowActions(track)}
					{#if canManage}
						<Action
							action={renameTrackForm.for(track.id)}
							iconOnly
							variant="ghost"
							size="sm"
							label={m.band_slug_music_release_id_rename()}
							modalTitle={m.band_slug_music_release_id_rename_track()}
							submitLabel={m.band_save()}
							successToast={m.band_slug_music_release_id_track_renamed()}
						>
							{#snippet icon()}<IconPencil size={16} />{/snippet}
							{#snippet form()}
								{@const fields = renameTrackForm.for(track.id).fields}
								<div class="space-y-4">
									<input {...fields.slug.as('hidden', slug)} />
									<input {...fields.releaseId.as('hidden', releaseId)} />
									<input {...fields.trackId.as('hidden', track.id)} />
									<FormField
										field={fields.title}
										label={m.band_title()}
										value={track.title}
										required
									/>
								</div>
							{/snippet}
						</Action>

						<!-- A form, not a callback, so deleting works without JS and the
						     confirm text can name the track. -->
						<Action
							action={deleteTrackForm.for(track.id)}
							iconOnly
							variant="ghost"
							size="sm"
							label={m.band_slug_music_release_id_delete()}
							modalTitle={m.band_slug_music_release_id_delete_track()}
							submitLabel={m.band_slug_music_release_id_delete()}
							submitVariant="error"
							successToast={m.band_slug_music_release_id_track_deleted()}
						>
							{#snippet icon()}<IconTrash size={16} />{/snippet}
							{#snippet form()}
								{@const fields = deleteTrackForm.for(track.id).fields}
								<div class="space-y-4">
									<input {...fields.slug.as('hidden', slug)} />
									<input {...fields.releaseId.as('hidden', releaseId)} />
									<input {...fields.trackId.as('hidden', track.id)} />
									<p>
										<ParaglideMessage
											message={m.band_slug_music_release_id_delete_audio_file_removed_good}
											inputs={{ title: track.title }}
											>{#snippet strong({ children })}<strong>{@render children?.()}</strong
												>{/snippet}</ParaglideMessage
										>
									</p>
								</div>
							{/snippet}
						</Action>
					{/if}
				{/snippet}
			</TrackList>
		</CardBody>
	</Card>

	<!-- The cover. The slot had three readers and a deleter and no writer, so
	     every release showed the IconDisc fallback forever — while the create
	     modal told bands the cover lived here (#1072). -->
	{#if canManage}
		<Card>
			<CardBody row>
				{#if release.coverUrl}
					<img src={release.coverUrl} alt="" class="size-24 shrink-0 rounded object-cover" />
				{:else}
					<div class="grid size-24 shrink-0 place-items-center rounded bg-base-200 text-subtle">
						<IconDisc size={28} />
					</div>
				{/if}
				<div class="grow">
					<CardTitle>{m.band_slug_music_release_id_cover()}</CardTitle>
					<p class="text-muted">
						{m.band_slug_music_release_id_square_art_shown_wherever_record()}
					</p>
					<div class="mt-2">
						<FileUpload
							upload={handleCoverUpload}
							accept="image/*"
							showPreview={false}
							emptyLabel={release.coverUrl
								? m.band_slug_music_release_id_replace_cover()
								: m.band_slug_music_release_id_add_cover()}
						/>
					</div>
				</div>
				{#if release.coverUrl}
					<Button type="button" variant="ghost" size="sm" onclick={removeCover}
						>{m.band_remove()}</Button
					>
				{/if}
			</CardBody>
		</Card>
	{/if}

	<!-- Radio consent, on its own control. A checkbox that only takes effect when
	     you also press Save on the metadata below is the kind of consent people
	     get wrong in both directions. -->
	{#if canManage}
		<Card>
			<CardBody>
				<CardTitle>
					<IconRadio size={18} />
					{m.band_slug_music_release_id_cmc_radio()}
				</CardTitle>
				<p class="text-muted">
					{m.band_slug_music_release_id_put_record_rotation_station_plays()}
				</p>
				<p class="text-muted text-sm">
					{m.band_slug_music_release_id_station_pays_no_licence_fees()}
				</p>

				{#if release.radioExcluded}
					<Alert type="warning">
						{m.band_slug_music_release_id_staff_pulled_release_from_rotatio({
							value: release.radioExcludedReason ? ` — ${release.radioExcludedReason}` : ''
						})}
					</Alert>
				{/if}

				<Form
					remote={setRadioOptInForm.for(releaseId)}
					successToast={m.band_slug_music_release_id_radio_setting_saved()}
					class="mt-2"
				>
					{@const fields = setRadioOptInForm.for(releaseId).fields}
					<input {...fields.slug.as('hidden', slug)} />
					<input {...fields.releaseId.as('hidden', releaseId)} />
					<FormField
						field={fields.radioOptIn}
						type="toggle"
						label={m.band_slug_music_release_id_include_cmc_radio()}
						checkboxLabel={m.band_slug_music_release_id_air()}
						value={release.radioOptIn}
					/>
					{#if release.radioAttested && release.radioAttestedAt && release.radioAttestationExpiresAt}
						<p class="text-muted text-sm">
							{m.band_slug_music_release_id_attested_good_until({
								formatDate: formatDate(release.radioAttestedAt),
								formatDate2: formatDate(release.radioAttestationExpiresAt),
								text: RADIO_PRO_ATTESTATION.text
							})}
						</p>
					{:else if release.radioOptIn}
						<Alert type="warning">
							{release.radioAttestedAt
								? m.band_slug_music_release_id_attestation_release_has_run_out()
								: m.band_slug_music_release_id_release_off_air_until_someone()}
						</Alert>
					{/if}
					{#if !release.radioAttested || release.radioAttestationRenewable}
						<FormField
							field={fields.attestNotPro}
							type="checkbox"
							label={m.band_slug_music_release_id_performing_rights()}
							checkboxLabel={RADIO_PRO_ATTESTATION.text}
							description={m.band_slug_music_release_id_required_go_air_again_every()}
						/>
					{/if}
					<SubmitButton>{m.band_save()}</SubmitButton>
				</Form>

				{#if outOfRange.length > 0}
					<Alert type="info">
						{m.band_slug_music_release_id_station_plays_tracks_between_long({
							formatRuntime: formatRuntime(RADIO_MIN_TRACK_MS),
							formatRuntime2: formatRuntime(RADIO_MAX_TRACK_MS),
							join: outOfRange.map((t) => t.title).join(', ')
						})}
					</Alert>
				{/if}
			</CardBody>
		</Card>
	{/if}

	{#if canManage}
		<Card>
			<CardBody>
				<CardTitle>{m.band_slug_music_release_id_price()}</CardTitle>
				<p class="text-muted">
					{m.band_slug_music_release_id_name_minimum_free_real_answer()}
				</p>

				{#if release.priceMinCents > 0 && !canSell}
					<!-- The state that would otherwise fail silently at Publish: a price
					     is set but nothing can take the money. -->
					<Alert type="warning">
						<ParaglideMessage
							message={m.band_slug_music_release_id_release_has_price_but_payouts}
							inputs={{}}
							>{#snippet a({ children })}<a
									class="link"
									href={resolve(`band/${band.slug}/music/payouts`)}>{@render children?.()}</a
								>{/snippet}</ParaglideMessage
						>
					</Alert>
				{/if}

				<Form
					remote={updatePricingForm.for(releaseId)}
					successToast={m.band_slug_music_release_id_price_saved()}
				>
					{@const fields = updatePricingForm.for(releaseId).fields}
					<input {...fields.slug.as('hidden', slug)} />
					<input {...fields.releaseId.as('hidden', releaseId)} />
					<MoneyField
						field={fields.priceMinCents}
						label={m.band_slug_music_release_id_minimum_price()}
						value={release.priceMinCents}
						description={m.band_slug_music_release_id_enter_0_give_away()}
					/>
					<FormField
						field={fields.allowPayMore}
						type="toggle"
						label={m.band_slug_music_release_id_let_buyers_pay_more()}
						checkboxLabel={m.band_slug_music_release_id_name_price()}
						value={release.allowPayMore}
					/>
					<SubmitButton label={m.band_slug_music_release_id_save_price()} />
				</Form>
			</CardBody>
		</Card>

		<Card>
			<CardBody>
				<CardTitle>{m.band_slug_music_release_id_details()}</CardTitle>
				<Form
					remote={updateReleaseForm}
					successToast={m.band_slug_music_release_id_release_saved()}
					guard
				>
					<input {...editFields.slug.as('hidden', slug)} />
					<input {...editFields.releaseId.as('hidden', releaseId)} />

					<FormField
						field={editFields.title}
						label={m.band_title()}
						value={release.title}
						required
					/>
					<FormField
						field={editFields.kind}
						label={m.band_type()}
						type="select"
						options={kindOptions}
						value={release.kind}
						required
					/>
					<FormField
						field={editFields.releasedAt}
						label={m.band_release_date()}
						type="date"
						value={release.releasedAt ? toLocalDate(release.releasedAt) : ''}
					/>
					<!-- Custom-input mode: `type="textarea"` drops rows and placeholder. -->
					<FormField
						field={editFields.description}
						label={m.band_slug_music_release_id_about_release()}
					>
						{#snippet input(id)}
							<textarea
								{...editFields.description.as('text')}
								{id}
								class="textarea w-full"
								rows="4"
								placeholder={m.band_slug_music_release_id_placeholder()}
								>{release.description ?? ''}</textarea
							>
						{/snippet}
					</FormField>

					<SubmitButton label={m.band_slug_music_release_id_save_details()} />
				</Form>
			</CardBody>
		</Card>

		<Card>
			<CardBody>
				<CardTitle>{m.band_slug_music_release_id_publishing()}</CardTitle>
				{#if release.status === 'published'}
					<p class="text-muted">
						{m.band_slug_music_release_id_release_public_unpublishing_hides()}
					</p>
					<div class="flex flex-wrap gap-2">
						<Action
							action={unpublishReleaseForm.for(releaseId)}
							label={m.band_slug_music_release_id_unpublish()}
							variant="ghost"
							modalTitle={m.band_slug_music_release_id_unpublish_release()}
							submitLabel={m.band_slug_music_release_id_unpublish()}
							successToast={m.band_slug_music_release_id_release_unpublished()}
						>
							{#snippet form()}
								{@const fields = unpublishReleaseForm.for(releaseId).fields}
								<input {...fields.slug.as('hidden', slug)} />
								<input {...fields.releaseId.as('hidden', releaseId)} />
								<p>
									<ParaglideMessage
										message={m.band_slug_music_release_id_hide_from_site}
										inputs={{ title: release.title }}
										>{#snippet strong({ children })}<strong>{@render children?.()}</strong
											>{/snippet}</ParaglideMessage
									>
								</p>
							{/snippet}
						</Action>
					</div>
				{:else if release.status === 'draft'}
					<p class="text-muted">
						{#if tracks.length === 0}
							{m.band_slug_music_release_id_add_at_least_one_track()}
						{:else}
							{m.band_slug_music_release_id_publishing_puts_record_profile_gi()}
						{/if}
					</p>
					<Action
						action={publishReleaseForm.for(releaseId)}
						label={m.band_slug_music_release_id_publish()}
						disabled={tracks.length === 0}
						modalTitle={m.band_slug_music_release_id_publish_release()}
						data-testid="publish-release"
						submitLabel={m.band_slug_music_release_id_publish()}
						successToast={m.band_slug_music_release_id_release_published()}
					>
						{#snippet form()}
							{@const fields = publishReleaseForm.for(releaseId).fields}
							<input {...fields.slug.as('hidden', slug)} />
							<input {...fields.releaseId.as('hidden', releaseId)} />
							<p>
								<ParaglideMessage
									message={m.band_slug_music_release_id_publish_becomes_visible_band_s}
									inputs={{ title: release.title }}
									>{#snippet strong({ children })}<strong>{@render children?.()}</strong
										>{/snippet}</ParaglideMessage
								>
							</p>
						{/snippet}
					</Action>
				{/if}

				<div class="mt-4 border-t border-base-300 pt-4">
					<Action
						action={deleteReleaseForm.for(releaseId)}
						label={m.band_slug_music_release_id_delete_release()}
						variant="ghost"
						size="sm"
						class="text-error"
						modalTitle={m.band_slug_music_release_id_delete_release()}
						data-testid="delete-release"
						submitLabel={m.band_slug_music_release_id_delete()}
						submitVariant="error"
						successToast={m.band_slug_music_release_id_release_deleted()}
						onsuccess={() => goto(resolve(`band/${band.slug}/music`))}
					>
						{#snippet form()}
							{@const fields = deleteReleaseForm.for(releaseId).fields}
							<div class="space-y-3">
								<input {...fields.slug.as('hidden', slug)} />
								<input {...fields.releaseId.as('hidden', releaseId)} />
								<p>
									<ParaglideMessage
										message={m.band_slug_music_release_id_delete_its_tracks}
										inputs={{ title: release.title, length: tracks.length }}
										>{#snippet strong({ children })}<strong>{@render children?.()}</strong
											>{/snippet}</ParaglideMessage
									>
								</p>
								<p class="text-muted">
									{m.band_slug_music_release_id_if_anyone_has_bought_release()}
								</p>
							</div>
						{/snippet}
					</Action>
				</div>
			</CardBody>
		</Card>
	{/if}
</PageContent>
