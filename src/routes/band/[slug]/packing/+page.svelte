<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { Field } from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import PackingCrate from './PackingCrate.svelte';
	import LoadInList from './LoadInList.svelte';
	import PromoteToRider from './PromoteToRider.svelte';
	import {
		getBandPackingPage,
		savePackingNotes,
		resetPackingList
	} from '$lib/remote/packing.remote';
	import { resolve } from '$app/paths';
	import { PACKING_NOTES_MAX } from '$lib/config';
	import type { PackingItemRowState } from '$lib/types/packing';
	import { getBandLayoutContext } from '../layout-context';

	/**
	 * What goes in the van, who is bringing it, and whether it is loaded yet.
	 * Every member gets this page; a member's save touches only their own rows.
	 * Rationale: docs/specs/packing-list-spec.md
	 *
	 * Read above the awaited query: a declaration after a top-level await is
	 * async-gated, which compiles every `fields.X.as()` into an async derived.
	 */
	const notesFields = savePackingNotes.fields;
	const resetFields = resetPackingList.fields;

	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);

	// One load-bearing query. Fanning several out of a component is what
	// `custom/no-concurrent-remote-queries` forbids, and past kit 2.64 it stops
	// the page rendering at all.
	const data = $derived(await getBandPackingPage(layout.band.id));

	const list = $derived(data.list);
	const roster = $derived(data.roster);

	/** The server's rows as the editor holds them: a client id, no sort order. */
	function toRows(userId: string | null): PackingItemRowState[] {
		return list.items
			.filter((it) => it.userId === userId)
			.map((it) => ({
				rowId: it.id,
				id: it.id,
				category: it.category,
				label: it.label,
				quantity: it.quantity,
				riderKind: it.riderKind ?? undefined,
				notes: it.notes ?? ''
			}));
	}

	const others = $derived(roster.filter((m) => m.userId !== data.viewerId));
	const mine = $derived(roster.find((m) => m.userId === data.viewerId) ?? null);

	/**
	 * A version stamp for `{#key}`. The crates hold a working copy in local
	 * state, so they remount when what the band *brings* changes — never on a
	 * tick or a claim, which is why neither of those touches `updatedAt`.
	 */
	const stamp = $derived(list.updatedAt?.getTime() ?? 0);

	const dateFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

	/**
	 * How stale the ticks are. A list that has not been reset in a month is
	 * describing a van somebody is standing next to, so this leads the page.
	 */
	const daysSinceReset = $derived(
		list.lastResetAt ? Math.floor((Date.now() - list.lastResetAt.getTime()) / 86_400_000) : null
	);

	function refresh() {
		void getBandPackingPage(layout.band.id).refresh();
	}
</script>

<PageHeader
	title="Packing list"
	subtitle="What {layout.band.name} takes to a gig"
	documentTitle="Packing list · {layout.band.name}"
>
	<Button
		href={resolve('/band/[slug]/rider', { slug: layout.band.slug })}
		variant="ghost"
		size="sm"
	>
		Tech rider
	</Button>
</PageHeader>

<PageContent width="3xl">
	{#if data.isStaffViewer}
		<Alert type="info" class="mb-4">
			You're reading this as staff. Only the band's own members can change it, or tick anything off.
		</Alert>
	{/if}

	<div class="mb-6 grid grid-cols-3 gap-3">
		<!--
			Unassigned first, deliberately. An unassigned row is what actually loses
			gear and it is actionable days out; a packed count only means something
			during load-in.
		-->
		<StatCard title="Nobody has" value={list.unassignedCount} size="sm" />
		<StatCard title="In the van" value="{list.packedCount}/{list.itemCount}" size="sm" />
		<StatCard title="Things" value={list.itemCount} size="sm" />
	</div>

	{#if list.itemCount > 0}
		<Card class="mb-6">
			<CardBody>
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<div>
						<h2 class="text-base font-semibold">Load-in</h2>
						<p class="text-xs text-base-content/60">
							{#if list.lastResetAt}
								Cleared {dateFmt.format(list.lastResetAt)}
								{#if list.lastResetByName}by {list.lastResetByName}{/if}
								{#if daysSinceReset !== null && daysSinceReset > 30}
									— which was a while ago
								{/if}
							{:else}
								Never cleared. Ticks stay until somebody resets them.
							{/if}
						</p>
					</div>

					{#if data.isOnRoster && list.packedCount > 0}
						<Form
							remote={resetPackingList}
							guard
							successToast="Cleared for the next load-in"
							onsuccess={refresh}
						>
							<input {...resetFields.bandId.as('hidden', data.bandId)} />
							<SubmitButton label="Clear the ticks" variant="ghost" size="sm" />
						</Form>
					{/if}
				</div>

				{#if list.unassignedCount > 0}
					<Alert type="warning" class="mb-4">
						<strong>{list.unassignedCount}</strong>
						{list.unassignedCount === 1 ? 'thing has' : 'things have'} nobody bringing them. That is how
						gear gets left behind — not because nobody knew it existed.
					</Alert>
				{/if}

				<LoadInList
					bandId={data.bandId}
					items={list.items}
					{roster}
					viewerId={data.viewerId}
					canManage={data.canManage}
					isOnRoster={data.isOnRoster}
					onchanged={refresh}
				/>
			</CardBody>
		</Card>
	{/if}

	{#if data.isOnRoster}
		<PromoteToRider
			bandId={data.bandId}
			items={list.items}
			viewerId={data.viewerId}
			onpromoted={refresh}
		/>
	{/if}

	<div class="space-y-6">
		<h2 class="text-base font-semibold">What everyone brings</h2>
		<p class="-mt-4 text-xs text-base-content/60">
			Editing here changes what the band brings. It never unpacks a box or drops whoever agreed to
			carry one.
		</p>

		{#key stamp}
			{#if mine}
				<PackingCrate
					bandId={data.bandId}
					ownerUserId={data.viewerId}
					slotKey="mine"
					title="Your gear"
					subtitle="What you bring. Only you and the band's admins can change this."
					initial={toRows(data.viewerId)}
					mine
					canEdit
					onsaved={refresh}
				/>
			{/if}

			{#each others as member, i (member.userId)}
				{@const rows = toRows(member.userId)}
				{#if rows.length > 0 || data.canManage}
					<PackingCrate
						bandId={data.bandId}
						ownerUserId={member.userId}
						slotKey="m{i}"
						title={member.name}
						subtitle={data.canManage
							? 'You can edit this as an admin — but they know their own gear.'
							: undefined}
						initial={rows}
						canEdit={data.canManage}
						onsaved={refresh}
					/>
				{/if}
			{/each}

			{#if toRows(null).length > 0 || data.canManage}
				<PackingCrate
					bandId={data.bandId}
					ownerUserId={null}
					slotKey="shared"
					title="The band's own stuff"
					subtitle="The merch tub, the spare stands — things nobody owns but somebody still has to carry. Admins only, because there is no member whose crate it is."
					initial={toRows(null)}
					canEdit={data.canManage}
					onsaved={refresh}
				/>
			{/if}
		{/key}

		<Card>
			<CardBody>
				<h2 class="mb-3 text-base font-semibold">Notes for the band</h2>
				{#if data.canManage}
					<Form
						remote={savePackingNotes}
						guard
						successToast="Saved"
						onsuccess={refresh}
						class="space-y-4"
					>
						<input {...notesFields.bandId.as('hidden', data.bandId)} />
						<Field
							field={notesFields.notes}
							type="textarea"
							label="Anything the band needs reminding of"
							value={list.notes ?? ''}
							maxlength={PACKING_NOTES_MAX}
							description="Where the trailer key lives, which door to load through. Nobody outside the band reads this."
						/>
						<div class="flex justify-end"><SubmitButton label="Save" /></div>
					</Form>
				{:else if list.notes}
					<p class="text-sm whitespace-pre-line">{list.notes}</p>
				{:else}
					<p class="text-sm text-base-content/60">Nothing noted.</p>
				{/if}
			</CardBody>
		</Card>
	</div>
</PageContent>
