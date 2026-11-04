<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/** One sponsor: who to call, and every term of support they have given. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import SponsorFields from '#lib/components/sponsor/SponsorFields.svelte';
	import SponsorshipFields from './SponsorshipFields.svelte';
	import PlacementFields from './PlacementFields.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
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
	} from '#lib/remote/sponsors.remote.js';
	import { sponsorshipStatusLabels, sponsorshipStatusBadge } from '#lib/config.js';
	import { formatCents, formatDateShortYear } from '#lib/utils/format.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const id = $derived(page.params.id!);
	const sponsor = $derived(await getSponsorDetail(id));
	const editForm = $derived(updateSponsor.for(id));

	const contact = $derived([sponsor.contactName, sponsor.contactEmail].filter(Boolean).join(' · '));
	const lapsed = $derived(sponsor.sponsorships.find((s) => s.deadline?.overdue));
</script>

<PageHeader title={sponsor.name} subtitle={m.staff_sponsor()}>
	<Action
		action={editForm}
		label={m.staff_edit()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2({ name: sponsor.name })}
		submitLabel={m.staff_save()}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input {...editForm.fields.id.as('hidden', sponsor.id)} />
			<SponsorFields fields={editForm.fields} value={sponsor} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if sponsor.deletedAt}
		<Alert type="warning">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<span>
					<ParaglideMessage
						message={m.staff_sponsors_id_off_sponsor_list_with_every}
						inputs={{ staff_archived_2: m.staff_archived_2() }}
						>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				</span>
				<Action
					action={restoreSponsor.for(sponsor.id)}
					label={m.staff_restore()}
					variant="ghost"
					size="xs"
					successToast={m.staff_restored()}
					noFooter
				>
					{#snippet form()}
						<input {...restoreSponsor.for(sponsor.id).fields.id.as('hidden', sponsor.id)} />
					{/snippet}
				</Action>
			</div>
		</Alert>
	{/if}

	{#if lapsed}
		<Alert type="warning">
			{m.staff_sponsors_id_ended_renew_with_new_sponsorship({
				title: lapsed.title,
				formatIsoDay: formatIsoDay(lapsed.endsOn)
			})}
		</Alert>
	{/if}

	<InfoCard title={m.staff_contact()}>
		<DefinitionList>
			<Fact label={m.staff_contact()} value={contact || '—'} />
			<Fact label={m.staff_website()} value={sponsor.website ?? '—'} />
			{#if sponsor.notes}
				<Fact label={m.staff_notes()} wrap>{sponsor.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title={m.staff_sponsors_id_logo()}>
		{#snippet action()}
			<Action
				action={setSponsorLogo}
				label={sponsor.logoUrl ? m.staff_sponsors_id_replace() : m.staff_upload()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_sponsors_id_logo_2({ name: sponsor.name })}
				submitLabel={m.staff_upload()}
				successToast={m.staff_sponsors_id_logo_saved()}
			>
				{#snippet form()}
					<input {...setSponsorLogo.fields.sponsorId.as('hidden', sponsor.id)} />
					<Field
						field={setSponsorLogo.fields.logo}
						type="file"
						label={m.staff_sponsors_id_logo()}
						accept="image/jpeg,image/png,image/webp"
						description={m.staff_sponsors_id_shown_beside_their_credit_event()}
					/>
				{/snippet}
			</Action>
		{/snippet}
		{#if sponsor.logoUrl}
			<div class="flex items-center gap-4">
				<img
					src={sponsor.logoUrl}
					alt={m.staff_sponsors_id_logo_2({ name: sponsor.name })}
					class="h-16 w-auto"
				/>
				<Action
					action={removeSponsorLogo}
					label={m.staff_remove()}
					variant="ghost"
					size="sm"
					class="text-error"
					modalTitle={m.staff_sponsors_id_remove_logo()}
					submitLabel={m.staff_remove()}
					submitVariant="error"
					successToast={m.staff_sponsors_id_logo_removed()}
				>
					{#snippet form()}
						<input {...removeSponsorLogo.fields.sponsorId.as('hidden', sponsor.id)} />
						<p class="text-sm">{m.staff_sponsors_id_their_credits_show_name_alone()}</p>
					{/snippet}
				</Action>
			</div>
		{:else}
			<p class="text-muted">{m.staff_sponsors_id_no_logo_credits_show_name()}</p>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_sponsors_id_sponsorships()}>
		{#snippet action()}
			<Action
				action={createSponsorship}
				label={m.staff_sponsors_id_add_sponsorship()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_sponsors_id_new_sponsorship()}
				submitLabel={m.staff_add()}
				successToast={m.staff_sponsors_id_sponsorship_added()}
			>
				{#snippet form()}
					<input {...createSponsorship.fields.sponsorId.as('hidden', sponsor.id)} />
					<SponsorshipFields fields={createSponsorship.fields} />
				{/snippet}
			</Action>
		{/snippet}
		{#if sponsor.sponsorships.length === 0}
			<EmptyState
				title={m.staff_sponsors_id_no_sponsorships_yet()}
				description={m.staff_sponsors_id_add_term_they_have_agreed()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_sponsors_id_sponsorship()}</th>
					<th>{m.staff_sponsors_id_term()}</th>
					<th class="col-support cell-num">{m.staff_amount()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
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
									label={m.staff_sponsors_id_place()}
									variant="ghost"
									size="sm"
									modalTitle={m.staff_sponsors_id_credit_show({ title: s.title })}
									submitLabel={m.staff_sponsors_id_place()}
									successToast={m.staff_sponsors_id_placed()}
								>
									{#snippet form()}
										<input
											{...placeSponsorship.for(s.id).fields.sponsorId.as('hidden', sponsor.id)}
										/>
										<input
											{...placeSponsorship.for(s.id).fields.sponsorshipId.as('hidden', s.id)}
										/>
										<PlacementFields fields={placeSponsorship.for(s.id).fields} />
									{/snippet}
								</Action>
							{/if}
							<Action
								action={edit}
								label={m.staff_edit()}
								variant="ghost"
								size="sm"
								modalTitle={m.staff_edit_3({ title: s.title })}
								submitLabel={m.staff_save()}
								successToast={m.staff_saved()}
							>
								{#snippet form()}
									<input {...edit.fields.id.as('hidden', s.id)} />
									<input {...edit.fields.sponsorId.as('hidden', sponsor.id)} />
									<SponsorshipFields fields={edit.fields} value={s} />
								{/snippet}
							</Action>
							<Action
								action={deleteSponsorship.for(s.id)}
								label={m.staff_delete()}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_delete_3({ title: s.title })}
								submitLabel={m.staff_delete()}
								submitVariant="error"
								successToast={m.staff_deleted()}
							>
								{#snippet form()}
									<input {...deleteSponsorship.for(s.id).fields.id.as('hidden', s.id)} />
									<input
										{...deleteSponsorship.for(s.id).fields.sponsorId.as('hidden', sponsor.id)}
									/>
									<p class="text-sm">
										{m.staff_sponsors_id_row_should_never_have_existed()}
									</p>
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_sponsors_id_event_placements()}>
		{#if sponsor.placements.length === 0}
			<EmptyState
				title={m.staff_sponsors_id_not_placed_any_show()}
				description={m.staff_sponsors_id_place_sponsorship_credit_them_event()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_show()}</th>
					<th class="col-support">{m.staff_sponsors_id_sponsorship()}</th>
					<th>{m.staff_sponsors_id_credited()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
				{/snippet}
				{#each sponsor.placements as p (p.id)}
					<tr>
						<td class="cell-primary">
							<a class="link font-medium" href={resolve(`staff/events/${p.eventId}`)}>
								{p.eventTitle}
							</a>
							<div class="text-muted">{formatDateShortYear(p.startsAt)}</div>
						</td>
						<td class="col-support">{p.sponsorshipTitle}</td>
						<td class="whitespace-nowrap">
							{#if p.onEventPage}<Badge variant="outline" size="sm">{m.staff_event_page()}</Badge
								>{/if}
							{#if p.inCampaign}<Badge variant="outline" size="sm">{m.staff_email()}</Badge>{/if}
						</td>
						<td class="w-px">
							<Action
								action={removePlacement.for(p.id)}
								label={m.staff_remove()}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_sponsors_id_stop_crediting_them({ eventTitle: p.eventTitle })}
								submitLabel={m.staff_remove()}
								submitVariant="error"
								successToast={m.staff_removed()}
							>
								{#snippet form()}
									<input {...removePlacement.for(p.id).fields.id.as('hidden', p.id)} />
									<input {...removePlacement.for(p.id).fields.sponsorId.as('hidden', sponsor.id)} />
									<p class="text-sm">{m.staff_sponsors_id_emails_already_sent_keep_credit()}</p>
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
				label={m.staff_sponsors_id_archive_sponsor()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_archive_2({ name: sponsor.name })}
				submitLabel={m.staff_archive()}
				successToast={m.staff_archived()}
			>
				{#snippet form()}
					<input {...archiveSponsor.for(sponsor.id).fields.id.as('hidden', sponsor.id)} />
					<p class="text-sm">
						{m.staff_sponsors_id_comes_off_sponsor_list_its()}
					</p>
				{/snippet}
			</Action>
		{/if}
		{#if sponsor.sponsorships.length === 0}
			<Action
				action={deleteSponsor.for(sponsor.id)}
				label={m.staff_sponsors_id_delete_sponsor()}
				variant="ghost"
				size="sm"
				class="text-error"
				modalTitle={m.staff_delete_2({ name: sponsor.name })}
				submitLabel={m.staff_delete()}
				submitVariant="error"
				successToast={m.staff_deleted()}
				onsuccess={() => goto(resolve('staff/sponsors'))}
			>
				{#snippet form()}
					<input {...deleteSponsor.for(sponsor.id).fields.id.as('hidden', sponsor.id)} />
					<p class="text-sm">{m.staff_sponsors_id_row_should_never_have_existed_2()}</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
