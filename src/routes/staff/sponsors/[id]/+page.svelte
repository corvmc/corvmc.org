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
	import {
		getSponsorDetail,
		updateSponsor,
		deleteSponsor,
		createSponsorship,
		updateSponsorship,
		deleteSponsorship
	} from '$lib/remote/sponsors.remote';
	import { sponsorshipStatusLabels, sponsorshipStatusBadge } from '$lib/config';
	import { formatCents } from '$lib/utils/format';
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

	<div class="flex flex-wrap gap-2">
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
				<p class="text-sm">Only a sponsor with no sponsorships can be deleted.</p>
			{/snippet}
		</Action>
	</div>
</PageContent>
