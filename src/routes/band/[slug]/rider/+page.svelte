<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { Field } from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import RiderCorner from '$lib/components/rider/RiderCorner.svelte';
	import RiderUploads from '$lib/components/rider/RiderUploads.svelte';
	import { getBandRiderPage, saveRiderDetails } from '$lib/remote/rider.remote';
	import { riderMonitorFormatOptions, RIDER_NOTES_MAX } from '$lib/config';
	import type { RiderElementRowState } from '$lib/types/rider';
	import { getBandLayoutContext } from '../layout-context';

	/**
	 * The band's tech rider: what it needs on stage, and who answers for each
	 * bit of it.
	 *
	 * **Every member gets this page, not just owners and admins** — it is the one
	 * band-panel route that is not role-gated, because the whole premise is that
	 * the person who knows what their amp needs is the person who owns the amp.
	 * A member edits their own corner and reads everyone else's; an owner or
	 * admin edits any of them.
	 *
	 * Read above the awaited query: a declaration after a top-level await is
	 * async-gated, which would compile every `fields.X.as()` into an async
	 * derived.
	 */
	const detailFields = saveRiderDetails.fields;

	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	// One load-bearing query. Fanning several out of a component is what
	// `custom/no-concurrent-remote-queries` forbids, and past kit 2.64 it stops
	// the page rendering at all.
	const data = $derived(await getBandRiderPage(layout.band.id));

	const rider = $derived(data.rider);
	const roster = $derived(data.roster);

	/** The server's rows as the editor holds them: a client id, no channel numbers. */
	function toRows(userId: string | null): RiderElementRowState[] {
		return rider.elements
			.filter((el) => el.userId === userId)
			.map((el) => ({
				rowId: el.id,
				kind: el.kind,
				label: el.label,
				providedBy: el.providedBy,
				notes: el.notes ?? '',
				inputs: el.inputs.map((input) => ({
					rowId: input.id,
					label: input.label,
					source: input.source,
					micPref: input.micPref ?? '',
					phantom: input.phantom,
					stand: input.stand,
					monitorMixUserId: input.monitorMixUserId ?? '',
					notes: input.notes ?? ''
				}))
			}));
	}

	/** Everyone but the viewer, so their own corner can head the page. */
	const others = $derived(roster.filter((m) => m.userId !== data.viewerId));
	const mine = $derived(roster.find((m) => m.userId === data.viewerId) ?? null);

	const contactOptions = $derived([
		{ value: '', label: 'Nobody yet' },
		...roster.map((m) => ({ value: m.userId, label: m.name }))
	]);

	/**
	 * A version stamp for `{#key}`. The corners hold a working copy in local
	 * state, so they are remounted when the server's answer actually changes
	 * rather than re-seeded under somebody's hands mid-edit.
	 */
	const stamp = $derived(rider.updatedAt?.getTime() ?? 0);

	function refresh() {
		void getBandRiderPage(layout.band.id).refresh();
	}
</script>

<PageHeader
	title="Tech rider"
	subtitle="What {layout.band.name} needs on stage"
	documentTitle="Tech rider · {layout.band.name}"
/>

<PageContent width="3xl">
	{#if data.isStaffViewer}
		<Alert type="info" class="mb-4">
			You're reading this as staff. Only the band's own members can change it.
		</Alert>
	{/if}

	<div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
		<StatCard title="Channels" value={rider.channelCount} size="sm" />
		<StatCard title="Need +48V" value={rider.phantomCount} size="sm" />
		<StatCard title="Monitor mixes" value={rider.monitorMixCount} size="sm" />
		<StatCard title="Needed from CMC" value={rider.venueProvidedCount} size="sm" />
	</div>

	<div class="space-y-6">
		{#key stamp}
			<!--
				Only for somebody actually on the roster. A staffer reading a band's
				rider has no corner of their own, and rendering them an empty "Your
				gear" card invited them to fill in gear for a band they are not in.
			-->
			{#if mine}
				<RiderCorner
					bandId={data.bandId}
					ownerUserId={data.viewerId}
					title="Your gear"
					subtitle="What you bring and what it needs plugged in. Only you and the band's admins can change this."
					initial={toRows(data.viewerId)}
					{roster}
					mine
					canEdit
					onsaved={refresh}
				/>
			{/if}

			{#each others as member (member.userId)}
				{@const rows = toRows(member.userId)}
				{#if rows.length > 0 || data.canManage}
					<RiderCorner
						bandId={data.bandId}
						ownerUserId={member.userId}
						title={member.name}
						subtitle={data.canManage
							? 'You can edit this as an admin — but they can too, and they know their own rig.'
							: undefined}
						initial={rows}
						{roster}
						canEdit={data.canManage}
						onsaved={refresh}
					/>
				{/if}
			{/each}

			{#if toRows(null).length > 0 || data.canManage}
				<RiderCorner
					bandId={data.bandId}
					ownerUserId={null}
					title="The band's own gear"
					subtitle="Shared kit that belongs to nobody in particular — playback rigs, spare stands. Admins only, because there is no member whose corner it is."
					initial={toRows(null)}
					{roster}
					canEdit={data.canManage}
					onsaved={refresh}
				/>
			{/if}
		{/key}

		<Card>
			<CardBody>
				<h2 class="mb-3 text-base font-semibold">The rest of the rider</h2>
				{#if data.canManage}
					<Form
						remote={saveRiderDetails}
						guard
						successToast="Saved"
						onsuccess={refresh}
						class="space-y-4"
					>
						<input {...detailFields.bandId.as('hidden', data.bandId)} />
						<div class="grid gap-4 md:grid-cols-2">
							<Field
								field={detailFields.techContactUserId}
								type="select"
								label="Who an engineer should call"
								options={contactOptions}
								value={rider.techContactUserId ?? ''}
								description="Every rider guide asks for one name. It is the field most often missing."
							/>
							<Field
								field={detailFields.monitorFormat}
								type="select"
								label="Monitors"
								options={[{ value: '', label: 'No preference' }, ...riderMonitorFormatOptions]}
								value={rider.monitorFormat ?? ''}
							/>
						</div>
						<Field
							field={detailFields.notes}
							type="textarea"
							label="Anything else"
							value={rider.notes ?? ''}
							maxlength={RIDER_NOTES_MAX}
							description="Power, load-in, anything that is not a piece of gear."
						/>
						<div class="flex justify-end"><SubmitButton label="Save" /></div>
					</Form>
				{:else}
					<dl class="space-y-2 text-sm">
						<div>
							<dt class="text-xs text-base-content/60">Who an engineer should call</dt>
							<dd>
								{roster.find((m) => m.userId === rider.techContactUserId)?.name ?? 'Nobody yet'}
							</dd>
						</div>
						{#if rider.notes}
							<div>
								<dt class="text-xs text-base-content/60">Notes</dt>
								<dd class="whitespace-pre-line">{rider.notes}</dd>
							</div>
						{/if}
					</dl>
				{/if}
			</CardBody>
		</Card>

		<Card>
			<CardBody>
				<h2 class="mb-1 text-base font-semibold">Or hand over the one you already have</h2>
				<p class="mb-4 text-xs text-base-content/60">
					Filling in the list above is not compulsory. If you already send venues a rider PDF,
					upload it here and CMC will read that instead — and you can do both, which is what a typed
					input list beside a hand-drawn stage plot looks like.
				</p>
				<RiderUploads
					bandId={data.bandId}
					uploads={data.uploads}
					canManage={data.canManage}
					onchanged={refresh}
				/>
			</CardBody>
		</Card>
	</div>
</PageContent>
