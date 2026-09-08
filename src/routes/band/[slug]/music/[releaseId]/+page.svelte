<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import TrackList from '$lib/components/audio/TrackList.svelte';
	import TrackUploader from './TrackUploader.svelte';
	import MoneyField from '$lib/components/ui/Form/MoneyField.svelte';
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
	} from '$lib/remote/audio.remote';
	import { getBandLayoutContext } from '../../layout-context';
	import {
		releaseKinds,
		releaseKindLabels,
		RADIO_MIN_TRACK_MS,
		RADIO_MAX_TRACK_MS
	} from '$lib/config';
	import { formatTrackSummary, formatRuntime } from '$lib/utils/audio';
	import { toLocalDate } from '$lib/utils/format';
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
</script>

<PageHeader title={release.title} subtitle={band.name}>
	<Badge>{releaseKindLabels[release.kind]}</Badge>
	{#if release.status === 'draft'}
		<Badge variant="ghost">Draft</Badge>
	{:else if release.status === 'published'}
		<Badge variant="success">Published</Badge>
	{:else}
		<Badge variant="error">Withheld</Badge>
	{/if}
</PageHeader>

<PageContent width="2xl">
	{#if release.status === 'withheld'}
		<Alert type="error">
			CMC staff withheld this release{release.radioExcludedReason
				? ` — ${release.radioExcludedReason}`
				: ''}. It is not public and cannot be republished from here. Reply to the message staff sent
			you to sort it out.
		</Alert>
	{/if}

	<!-- Tracks first. Everything else on this page is a decision about a record
	     that does not exist until it has some. -->
	<Card>
		<CardBody>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<CardTitle>Tracks</CardTitle>
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

			<TrackList {tracks} empty="No tracks yet. Add some audio and this is where it plays.">
				{#snippet rowActions(track)}
					{#if canManage}
						<Action
							action={renameTrackForm.for(track.id)}
							iconOnly
							variant="ghost"
							size="sm"
							label="Rename"
							modalTitle="Rename track"
							submitLabel="Save"
							successToast="Track renamed"
						>
							{#snippet icon()}<IconPencil size={16} />{/snippet}
							{#snippet form()}
								{@const fields = renameTrackForm.for(track.id).fields}
								<div class="space-y-4">
									<input {...fields.slug.as('hidden', slug)} />
									<input {...fields.releaseId.as('hidden', releaseId)} />
									<input {...fields.trackId.as('hidden', track.id)} />
									<FormField field={fields.title} label="Title" value={track.title} required />
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
							label="Delete"
							modalTitle="Delete track"
							submitLabel="Delete"
							submitVariant="error"
							successToast="Track deleted"
						>
							{#snippet icon()}<IconTrash size={16} />{/snippet}
							{#snippet form()}
								{@const fields = deleteTrackForm.for(track.id).fields}
								<div class="space-y-4">
									<input {...fields.slug.as('hidden', slug)} />
									<input {...fields.releaseId.as('hidden', releaseId)} />
									<input {...fields.trackId.as('hidden', track.id)} />
									<p>
										Delete <strong>{track.title}</strong>? The audio file is removed for good.
										Anyone who already bought this release keeps their download.
									</p>
								</div>
							{/snippet}
						</Action>
					{/if}
				{/snippet}
			</TrackList>
		</CardBody>
	</Card>

	<!-- Radio consent, on its own control. A checkbox that only takes effect when
	     you also press Save on the metadata below is the kind of consent people
	     get wrong in both directions. -->
	{#if canManage}
		<Card>
			<CardBody>
				<CardTitle>
					<IconRadio size={18} /> CMC Radio
				</CardTitle>
				<p class="text-muted">
					Put this record in the rotation of the station that plays across the site. Independent of
					selling — a free release can be on the air, and no Stripe account is needed.
				</p>

				{#if release.radioExcluded}
					<Alert type="warning">
						Staff pulled this release from the rotation{release.radioExcludedReason
							? ` — ${release.radioExcludedReason}`
							: ''}.
					</Alert>
				{/if}

				<Form
					remote={setRadioOptInForm.for(releaseId)}
					successToast="Radio setting saved"
					class="mt-2"
				>
					{@const fields = setRadioOptInForm.for(releaseId).fields}
					<input {...fields.slug.as('hidden', slug)} />
					<input {...fields.releaseId.as('hidden', releaseId)} />
					<FormField
						field={fields.radioOptIn}
						type="toggle"
						label="Include in CMC Radio"
						checkboxLabel="On the air"
						value={release.radioOptIn}
					/>
					<SubmitButton>Save</SubmitButton>
				</Form>

				{#if outOfRange.length > 0}
					<Alert type="info">
						The station plays tracks between {formatRuntime(RADIO_MIN_TRACK_MS)} and
						{formatRuntime(RADIO_MAX_TRACK_MS)} long, so it will skip
						{outOfRange.map((t) => t.title).join(', ')}. The rest of the record still plays.
					</Alert>
				{/if}
			</CardBody>
		</Card>
	{/if}

	{#if canManage}
		<Card>
			<CardBody>
				<CardTitle>Price</CardTitle>
				<p class="text-muted">
					Name a minimum. Free is a real answer — it needs no Stripe account, and the record can
					still go out on CMC Radio.
				</p>

				{#if release.priceMinCents > 0 && !canSell}
					<!-- The state that would otherwise fail silently at Publish: a price
					     is set but nothing can take the money. -->
					<Alert type="warning">
						This release has a price, but payouts are not set up yet, so nobody can buy it.
						<a class="link" href={resolve(`/band/${band.slug}/music/payouts`)}>Set up payouts</a>
						— or set the price to zero to give it away.
					</Alert>
				{/if}

				<Form remote={updatePricingForm.for(releaseId)} successToast="Price saved">
					{@const fields = updatePricingForm.for(releaseId).fields}
					<input {...fields.slug.as('hidden', slug)} />
					<input {...fields.releaseId.as('hidden', releaseId)} />
					<MoneyField
						field={fields.priceMinCents}
						label="Minimum price"
						value={release.priceMinCents}
						description="Enter 0 to give it away."
					/>
					<FormField
						field={fields.allowPayMore}
						type="toggle"
						label="Let buyers pay more"
						checkboxLabel="Name your price"
						value={release.allowPayMore}
					/>
					<SubmitButton label="Save price" />
				</Form>
			</CardBody>
		</Card>

		<Card>
			<CardBody>
				<CardTitle>Details</CardTitle>
				<Form remote={updateReleaseForm} successToast="Release saved" guard>
					<input {...editFields.slug.as('hidden', slug)} />
					<input {...editFields.releaseId.as('hidden', releaseId)} />

					<FormField field={editFields.title} label="Title" value={release.title} required />
					<FormField
						field={editFields.kind}
						label="Type"
						type="select"
						options={kindOptions}
						value={release.kind}
						required
					/>
					<FormField
						field={editFields.releasedAt}
						label="Release date"
						type="date"
						value={release.releasedAt ? toLocalDate(release.releasedAt) : ''}
					/>
					<!-- Custom-input mode: `type="textarea"` drops rows and placeholder. -->
					<FormField field={editFields.description} label="About this release">
						{#snippet input(id)}
							<textarea
								{...editFields.description.as('text')}
								{id}
								class="textarea w-full"
								rows="4"
								placeholder="Who played on it, where it was recorded, anything you'd want a listener to know."
								>{release.description ?? ''}</textarea
							>
						{/snippet}
					</FormField>

					<SubmitButton label="Save details" />
				</Form>
			</CardBody>
		</Card>

		<Card>
			<CardBody>
				<CardTitle>Publishing</CardTitle>
				{#if release.status === 'published'}
					<p class="text-muted">
						This release is public. Unpublishing hides it from the site and takes it off the radio;
						anyone who bought it keeps their download.
					</p>
					<div class="flex flex-wrap gap-2">
						<Action
							action={unpublishReleaseForm.for(releaseId)}
							label="Unpublish"
							variant="ghost"
							modalTitle="Unpublish release"
							submitLabel="Unpublish"
							successToast="Release unpublished"
						>
							{#snippet form()}
								{@const fields = unpublishReleaseForm.for(releaseId).fields}
								<input {...fields.slug.as('hidden', slug)} />
								<input {...fields.releaseId.as('hidden', releaseId)} />
								<p>Hide <strong>{release.title}</strong> from the site?</p>
							{/snippet}
						</Action>
					</div>
				{:else if release.status === 'draft'}
					<p class="text-muted">
						{#if tracks.length === 0}
							Add at least one track before publishing.
						{:else}
							Publishing puts this record on your profile and gives it a page anyone can link to.
						{/if}
					</p>
					<Action
						action={publishReleaseForm.for(releaseId)}
						label="Publish"
						disabled={tracks.length === 0}
						modalTitle="Publish release"
						submitLabel="Publish"
						successToast="Release published"
					>
						{#snippet form()}
							{@const fields = publishReleaseForm.for(releaseId).fields}
							<input {...fields.slug.as('hidden', slug)} />
							<input {...fields.releaseId.as('hidden', releaseId)} />
							<p>
								Publish <strong>{release.title}</strong>? It becomes visible on your band's profile
								and at its own address.
							</p>
						{/snippet}
					</Action>
				{/if}

				<div class="mt-4 border-t border-base-300 pt-4">
					<Action
						action={deleteReleaseForm.for(releaseId)}
						label="Delete release"
						variant="ghost"
						size="sm"
						class="text-error"
						modalTitle="Delete release"
						submitLabel="Delete"
						submitVariant="error"
						successToast="Release deleted"
						onsuccess={() => goto(resolve(`/band/${band.slug}/music`))}
					>
						{#snippet form()}
							{@const fields = deleteReleaseForm.for(releaseId).fields}
							<div class="space-y-3">
								<input {...fields.slug.as('hidden', slug)} />
								<input {...fields.releaseId.as('hidden', releaseId)} />
								<p>
									Delete <strong>{release.title}</strong> and its
									{tracks.length}
									{tracks.length === 1 ? 'track' : 'tracks'}?
								</p>
								<p class="text-muted">
									If anyone has bought this release it is archived instead of deleted, so their
									download keeps working.
								</p>
							</div>
						{/snippet}
					</Action>
				</div>
			</CardBody>
		</Card>
	{/if}
</PageContent>
