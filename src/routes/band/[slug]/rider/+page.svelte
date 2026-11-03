<script lang="ts">
	import { m as msg } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { Field } from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import RiderCorner from '$lib/components/rider/RiderCorner.svelte';
	import RiderUploads from '$lib/components/rider/RiderUploads.svelte';
	import StagePlot from '$lib/components/rider/StagePlot.svelte';
	import {
		getBandRiderPage,
		saveRiderDetails,
		saveRiderPlacements
	} from '$lib/remote/rider.remote';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
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
	const placementFields = saveRiderPlacements.fields;

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
		{ value: '', label: msg.band_nobody_yet() },
		...roster.map((m) => ({ value: m.userId, label: m.name }))
	]);

	/**
	 * A version stamp for `{#key}`. The corners hold a working copy in local
	 * state, so they are remounted when the server's answer actually changes
	 * rather than re-seeded under somebody's hands mid-edit.
	 */
	const stamp = $derived(rider.updatedAt?.getTime() ?? 0);

	/**
	 * The room's own limit, and whether this rider is over it.
	 *
	 * A note rather than a refusal: plenty of rooms sub-mix a kit, and which
	 * inputs get combined is the house engineer's call. Saying it here is the
	 * "flag what the room cannot do" half of the Production user story, and the
	 * point is that it is found on the page rather than at load-in.
	 */
	const overCapacity = $derived(
		data.consoleChannels > 0 && rider.channelCount > data.consoleChannels
	);

	/**
	 * The stage, as the plot needs it: every element, plus whether this viewer may
	 * move each one. Monitors included — a wedge is exactly the sort of thing a
	 * plot exists to show the position of.
	 */
	const plotItems = $derived(
		rider.elements.map((el) => ({
			id: el.id,
			label: el.label,
			kind: el.kind,
			ownerName: el.ownerName,
			x: el.x,
			y: el.y,
			movable: data.canManage || (!!el.userId && el.userId === data.viewerId)
		}))
	);

	const canPlaceAny = $derived(plotItems.some((i) => i.movable));

	function refresh() {
		void getBandRiderPage(layout.band.id).refresh();
	}
</script>

<PageHeader
	width="3xl"
	title={msg.band_tech_rider()}
	subtitle={msg.band_slug_rider_what_needs_stage({ name: layout.band.name })}
	documentTitle={msg.band_slug_rider_document_title({ name: layout.band.name })}
>
	<Button
		href={resolve('/band/[slug]/rider/list', { slug: layout.band.slug })}
		variant="ghost"
		size="sm"
	>
		{msg.band_slug_rider_input_list()}
	</Button>
</PageHeader>

<PageContent width="3xl">
	{#if data.isStaffViewer}
		<Alert type="info" class="mb-4">
			{msg.band_slug_rider_re_reading_as_staff_only()}
		</Alert>
	{/if}

	{#if overCapacity}
		<Alert type="warning" class="mb-4">
			<ParaglideMessage
				message={msg.band_slug_rider_rider_asks_channels_room_s}
				inputs={{ channelCount: rider.channelCount, consoleChannels: data.consoleChannels }}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	<div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
		<StatCard title={msg.band_channels()} value={rider.channelCount} size="sm" />
		<StatCard title={msg.band_need_48v()} value={rider.phantomCount} size="sm" />
		<StatCard title={msg.band_monitor_mixes()} value={rider.monitorMixCount} size="sm" />
		<StatCard
			title={msg.band_slug_rider_needed_from_cmc()}
			value={rider.venueProvidedCount}
			size="sm"
		/>
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
					title={msg.band_gear()}
					subtitle={msg.band_slug_rider_what_bring_what_needs_plugged()}
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
						subtitle={data.canManage ? msg.band_slug_rider_can_edit_as_admin_but() : undefined}
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
					title={msg.band_slug_rider_band_s_own_gear()}
					subtitle={msg.band_slug_rider_shared_kit_belongs_nobody_particular()}
					initial={toRows(null)}
					{roster}
					canEdit={data.canManage}
					onsaved={refresh}
				/>
			{/if}
		{/key}

		<InfoCard title={msg.band_stage_plot()}>
			<p class="mb-3 text-xs text-base-content/60">
				{msg.band_slug_rider_where_everything_stands_drag_use()}
			</p>
			<Form
				remote={saveRiderPlacements}
				guard
				successToast={msg.band_slug_rider_stage_plot_saved()}
				onsuccess={refresh}
				class="space-y-3"
			>
				<input {...placementFields.bandId.as('hidden', data.bandId)} />
				<StagePlot items={plotItems} field={placementFields.placements} readonly={!canPlaceAny} />
				{#if canPlaceAny}
					<div class="flex justify-end">
						<SubmitButton label={msg.band_slug_rider_save_plot()} />
					</div>
				{/if}
			</Form>
		</InfoCard>

		<InfoCard title={msg.band_slug_rider_rest_rider()}>
			{#if data.canManage}
				<Form
					remote={saveRiderDetails}
					guard
					successToast={msg.band_saved()}
					onsuccess={refresh}
					class="space-y-4"
				>
					<input {...detailFields.bandId.as('hidden', data.bandId)} />
					<div class="grid gap-4 md:grid-cols-2">
						<Field
							field={detailFields.techContactUserId}
							type="select"
							label={msg.band_slug_rider_who_engineer_should_call()}
							options={contactOptions}
							value={rider.techContactUserId ?? ''}
							description={msg.band_slug_rider_every_rider_guide_asks_one()}
						/>
						<Field
							field={detailFields.monitorFormat}
							type="select"
							label={msg.band_monitors()}
							options={[
								{ value: '', label: msg.band_slug_rider_no_preference() },
								...riderMonitorFormatOptions
							]}
							value={rider.monitorFormat ?? ''}
						/>
					</div>
					<Field
						field={detailFields.notes}
						type="textarea"
						label={msg.band_slug_rider_anything_else()}
						value={rider.notes ?? ''}
						maxlength={RIDER_NOTES_MAX}
						description={msg.band_slug_rider_power_load_anything_not_piece()}
					/>
					<div class="flex justify-end"><SubmitButton label={msg.band_save()} /></div>
				</Form>
			{:else}
				<DefinitionList>
					<Fact label={msg.band_slug_rider_who_engineer_should_call()}>
						{roster.find((m) => m.userId === rider.techContactUserId)?.name ??
							msg.band_nobody_yet()}
					</Fact>
					{#if rider.notes}
						<Fact label={msg.band_notes()} class="whitespace-pre-line">{rider.notes}</Fact>
					{/if}
				</DefinitionList>
			{/if}
		</InfoCard>

		<InfoCard title={msg.band_slug_rider_hand_over_one_already_have()}>
			<p class="mb-4 text-xs text-base-content/60">
				{msg.band_slug_rider_filling_list_above_not_compulsory()}
			</p>
			<RiderUploads
				bandId={data.bandId}
				uploads={data.uploads}
				canManage={data.canManage}
				onchanged={refresh}
			/>
		</InfoCard>
	</div>
</PageContent>
