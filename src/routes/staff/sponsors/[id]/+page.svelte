<script lang="ts">
	/** One sponsor: who to call, and every term of support they have given. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import SponsorFields from '$lib/components/sponsor/SponsorFields.svelte';
	import SponsorshipFields from './SponsorshipFields.svelte';
	import PlacementFields from './PlacementFields.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		getSponsorDetail,
		updateSponsor,
		archiveSponsor,
		restoreSponsor,
		deleteSponsor,
		createSponsorship,
		updateSponsorship,
		deleteSponsorship,
		placeSponsorship,
		removePlacement,
		setSponsorLogo,
		removeSponsorLogo
	} from '$lib/remote/sponsors.remote';
	import { sponsorshipStatusLabels, sponsorshipStatusBadge } from '$lib/config';
	import { formatCents, formatDateShortYear } from '$lib/utils/format';
	import { formatIsoDay } from '$lib/utils/deadline';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const id = $derived(page.params.id!);
	const sponsor = $derived(await getSponsorDetail(id));
	const editForm = $derived(updateSponsor.for(id));

	const contact = $derived([sponsor.contactName, sponsor.contactEmail].filter(Boolean).join(' · '));
	const lapsed = $derived(sponsor.sponsorships.find((s) => s.deadline?.overdue));
</script>

<PageHeader title={sponsor.name} subtitle="Sponsor" backHref="/staff/sponsors">
	<Action
		action={editForm}
		label="Edit"
		variant="ghost"
		size="sm"
		modalTitle="Edit {sponsor.name}"
		submitLabel="Save"
		successToast="Saved"
	>
		{#snippet form()}
			<input type="hidden" name="id" value={sponsor.id} />
			<SponsorFields fields={editForm.fields} value={sponsor} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if sponsor.deletedAt}
		<Alert type="warning">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<span>
					<span class="font-medium">Archived.</span> Off the sponsor list, with every sponsorship and
					credit kept.
				</span>
				<Action
					action={restoreSponsor.for(sponsor.id)}
					label="Restore"
					variant="ghost"
					size="xs"
					successToast="Restored"
					noFooter
				>
					{#snippet form()}
						<input type="hidden" name="id" value={sponsor.id} />
					{/snippet}
				</Action>
			</div>
		</Alert>
	{/if}

	{#if lapsed}
		<Alert type="warning">
			{lapsed.title} ended {formatIsoDay(lapsed.endsOn)}. Renew it with a new sponsorship, or mark
			it ended.
		</Alert>
	{/if}

	<InfoCard title="Contact">
		<DefinitionList>
			<Fact label="Contact" value={contact || '—'} />
			<Fact label="Website" value={sponsor.website ?? '—'} />
			{#if sponsor.notes}
				<Fact label="Notes" wrap>{sponsor.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title="Logo">
		{#snippet action()}
			<Action
				action={setSponsorLogo}
				label={sponsor.logoUrl ? 'Replace' : 'Upload'}
				variant="ghost"
				size="sm"
				modalTitle="{sponsor.name} logo"
				submitLabel="Upload"
				successToast="Logo saved"
			>
				{#snippet form()}
					<input type="hidden" name="sponsorId" value={sponsor.id} />
					<Field
						field={setSponsorLogo.fields.logo}
						type="file"
						label="Logo"
						accept="image/jpeg,image/png,image/webp"
						description="Shown beside their credit on event pages."
					/>
				{/snippet}
			</Action>
		{/snippet}
		{#if sponsor.logoUrl}
			<div class="flex items-center gap-4">
				<img src={sponsor.logoUrl} alt="{sponsor.name} logo" class="h-16 w-auto" />
				<Action
					action={removeSponsorLogo}
					label="Remove"
					variant="ghost"
					size="sm"
					class="text-error"
					modalTitle="Remove the logo?"
					submitLabel="Remove"
					submitVariant="error"
					successToast="Logo removed"
				>
					{#snippet form()}
						<input type="hidden" name="sponsorId" value={sponsor.id} />
						<p class="text-sm">Their credits show the name alone until a new one is uploaded.</p>
					{/snippet}
				</Action>
			</div>
		{:else}
			<p class="text-muted">No logo. Credits show the name alone.</p>
		{/if}
	</InfoCard>

	<InfoCard title="Sponsorships">
		{#snippet action()}
			<Action
				action={createSponsorship}
				label="Add sponsorship"
				variant="ghost"
				size="sm"
				modalTitle="New sponsorship"
				submitLabel="Add"
				successToast="Sponsorship added"
			>
				{#snippet form()}
					<input type="hidden" name="sponsorId" value={sponsor.id} />
					<SponsorshipFields fields={createSponsorship.fields} />
				{/snippet}
			</Action>
		{/snippet}
		{#if sponsor.sponsorships.length === 0}
			<EmptyState title="No sponsorships yet" description="Add the term they have agreed to." />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Sponsorship</th>
					<th>Term</th>
					<th class="col-support cell-num">Amount</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each sponsor.sponsorships as s (s.id)}
					{@const edit = updateSponsorship.for(s.id)}
					<tr>
						<td class="w-px">
							<Badge variant={sponsorshipStatusBadge[s.status]} size="sm">
								{sponsorshipStatusLabels[s.status]}
							</Badge>
						</td>
						<td class="cell-primary">
							<span class="font-medium">{s.title}</span>
							{#if s.tier}<div class="text-muted">{s.tier}</div>{/if}
						</td>
						<td class="whitespace-nowrap">
							{formatIsoDay(s.startsOn)} –
							<span class:text-error={s.deadline?.overdue}>{formatIsoDay(s.endsOn)}</span>
						</td>
						<td class="col-support cell-num">
							{s.amountCents != null ? formatCents(s.amountCents) : '—'}
						</td>
						<td class="w-px whitespace-nowrap">
							{#if s.status !== 'declined'}
								<Action
									action={placeSponsorship.for(s.id)}
									label="Place"
									variant="ghost"
									size="sm"
									modalTitle="Credit {s.title} on a show"
									submitLabel="Place"
									successToast="Placed"
								>
									{#snippet form()}
										<input type="hidden" name="sponsorId" value={sponsor.id} />
										<input type="hidden" name="sponsorshipId" value={s.id} />
										<PlacementFields fields={placeSponsorship.for(s.id).fields} />
									{/snippet}
								</Action>
							{/if}
							<Action
								action={edit}
								label="Edit"
								variant="ghost"
								size="sm"
								modalTitle="Edit {s.title}"
								submitLabel="Save"
								successToast="Saved"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={s.id} />
									<input type="hidden" name="sponsorId" value={sponsor.id} />
									<SponsorshipFields fields={edit.fields} value={s} />
								{/snippet}
							</Action>
							<Action
								action={deleteSponsorship.for(s.id)}
								label="Delete"
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle="Delete {s.title}?"
								submitLabel="Delete"
								submitVariant="error"
								successToast="Deleted"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={s.id} />
									<input type="hidden" name="sponsorId" value={sponsor.id} />
									<p class="text-sm">
										For a row that should never have existed. A term that ran its course is Ended.
									</p>
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title="Event placements">
		{#if sponsor.placements.length === 0}
			<EmptyState
				title="Not placed on any show"
				description="Place a sponsorship to credit them on an event page or in its emails."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>Show</th>
					<th class="col-support">Sponsorship</th>
					<th>Credited</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each sponsor.placements as p (p.id)}
					<tr>
						<td class="cell-primary">
							<a class="link font-medium" href={resolve(`/staff/events/${p.eventId}`)}>
								{p.eventTitle}
							</a>
							<div class="text-muted">{formatDateShortYear(p.startsAt)}</div>
						</td>
						<td class="col-support">{p.sponsorshipTitle}</td>
						<td class="whitespace-nowrap">
							{#if p.onEventPage}<Badge variant="outline" size="sm">Event page</Badge>{/if}
							{#if p.inCampaign}<Badge variant="outline" size="sm">Email</Badge>{/if}
						</td>
						<td class="w-px">
							<Action
								action={removePlacement.for(p.id)}
								label="Remove"
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle="Stop crediting them on {p.eventTitle}?"
								submitLabel="Remove"
								submitVariant="error"
								successToast="Removed"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={p.id} />
									<input type="hidden" name="sponsorId" value={sponsor.id} />
									<p class="text-sm">Emails already sent keep the credit they went out with.</p>
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<div class="flex flex-wrap gap-2">
		{#if !sponsor.deletedAt}
			<Action
				action={archiveSponsor.for(sponsor.id)}
				label="Archive sponsor"
				variant="ghost"
				size="sm"
				modalTitle="Archive {sponsor.name}?"
				submitLabel="Archive"
				successToast="Archived"
			>
				{#snippet form()}
					<input type="hidden" name="id" value={sponsor.id} />
					<p class="text-sm">
						It comes off the sponsor list. Its sponsorships and event credits stay, and it can be
						restored.
					</p>
				{/snippet}
			</Action>
		{/if}
		{#if sponsor.sponsorships.length === 0}
			<Action
				action={deleteSponsor.for(sponsor.id)}
				label="Delete sponsor"
				variant="ghost"
				size="sm"
				class="text-error"
				modalTitle="Delete {sponsor.name}?"
				submitLabel="Delete"
				submitVariant="error"
				successToast="Deleted"
				onsuccess={() => goto(resolve('/staff/sponsors'))}
			>
				{#snippet form()}
					<input type="hidden" name="id" value={sponsor.id} />
					<p class="text-sm">For a row that should never have existed. It has no sponsorships.</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
