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
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	const id = $derived(params.id);
	const sponsor = $derived(await getSponsorDetail(id));
	const editForm = $derived(updateSponsor.for(id));

	const contact = $derived([sponsor.contactName, sponsor.contactEmail].filter(Boolean).join(' · '));
	const lapsed = $derived(sponsor.sponsorships.find((s) => s.deadline?.overdue));
</script>

<PageHeader title={sponsor.name} subtitle={m.staff_sponsor_body()}>
	<Action
		action={editForm}
		label={m.staff_edit_label()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2_title({ name: sponsor.name })}
		submitLabel={m.staff_save_label()}
		successToast={m.staff_saved_toast()}
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
						message={m.staff_sponsors_id_off_sponsor_list_with_every_text}
						inputs={{ staff_archived_2: m.staff_archived_2_text() }}
						>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				</span>
				<Action
					action={restoreSponsor.for(sponsor.id)}
					label={m.staff_restore_label()}
					variant="ghost"
					size="xs"
					successToast={m.staff_restored_toast()}
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
			{m.staff_sponsors_id_ended_renew_with_new_sponsorship_body({
				title: lapsed.title,
				formatIsoDay: formatIsoDay(lapsed.endsOn)
			})}
		</Alert>
	{/if}

	<InfoCard title={m.staff_contact_title()}>
		<DefinitionList>
			<Fact label={m.staff_contact_label()} value={contact || '—'} />
			<Fact label={m.staff_website_label()} value={sponsor.website ?? '—'} />
			{#if sponsor.notes}
				<Fact label={m.staff_notes_label()} wrap>{sponsor.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title={m.staff_sponsors_id_logo_title()}>
		{#snippet action()}
			<Action
				action={setSponsorLogo}
				label={sponsor.logoUrl ? m.staff_sponsors_id_replace_label() : m.staff_upload_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_sponsors_id_logo_2_title({ name: sponsor.name })}
				submitLabel={m.staff_upload_label()}
				successToast={m.staff_sponsors_id_logo_saved_toast()}
			>
				{#snippet form()}
					<input {...setSponsorLogo.fields.sponsorId.as('hidden', sponsor.id)} />
					<Field
						field={setSponsorLogo.fields.logo}
						type="file"
						label={m.staff_sponsors_id_logo_label()}
						accept="image/jpeg,image/png,image/webp"
						description={m.staff_sponsors_id_shown_beside_their_credit_event_body()}
					/>
				{/snippet}
			</Action>
		{/snippet}
		{#if sponsor.logoUrl}
			<div class="flex items-center gap-4">
				<img
					src={sponsor.logoUrl}
					alt={m.staff_sponsors_id_logo_2_text({ name: sponsor.name })}
					class="h-16 w-auto"
				/>
				<Action
					action={removeSponsorLogo}
					label={m.staff_remove_label()}
					variant="ghost"
					size="sm"
					class="text-error"
					modalTitle={m.staff_sponsors_id_remove_logo_title()}
					submitLabel={m.staff_remove_label()}
					submitVariant="error"
					successToast={m.staff_sponsors_id_logo_removed_toast()}
				>
					{#snippet form()}
						<input {...removeSponsorLogo.fields.sponsorId.as('hidden', sponsor.id)} />
						<p class="text-sm">{m.staff_sponsors_id_their_credits_show_name_alone_text()}</p>
					{/snippet}
				</Action>
			</div>
		{:else}
			<p class="text-muted">{m.staff_sponsors_id_no_logo_credits_show_name_text()}</p>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_sponsors_id_sponsorships_title()}>
		{#snippet action()}
			<Action
				action={createSponsorship}
				label={m.staff_sponsors_id_add_sponsorship_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_sponsors_id_new_sponsorship_title()}
				submitLabel={m.staff_add_label()}
				successToast={m.staff_sponsors_id_sponsorship_added_toast()}
			>
				{#snippet form()}
					<input {...createSponsorship.fields.sponsorId.as('hidden', sponsor.id)} />
					<SponsorshipFields fields={createSponsorship.fields} />
				{/snippet}
			</Action>
		{/snippet}
		{#if sponsor.sponsorships.length === 0}
			<EmptyState
				title={m.staff_sponsors_id_no_sponsorships_yet_title()}
				description={m.staff_sponsors_id_add_term_they_have_agreed_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_sponsors_id_sponsorship_label()}</th>
					<th>{m.staff_sponsors_id_term_label()}</th>
					<th class="col-support cell-num">{m.staff_amount_label()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
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
									label={m.staff_sponsors_id_place_label()}
									variant="ghost"
									size="sm"
									modalTitle={m.staff_sponsors_id_credit_show_title({ title: s.title })}
									submitLabel={m.staff_sponsors_id_place_label()}
									successToast={m.staff_sponsors_id_placed_toast()}
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
								label={m.staff_edit_label()}
								variant="ghost"
								size="sm"
								modalTitle={m.staff_edit_3_title({ title: s.title })}
								submitLabel={m.staff_save_label()}
								successToast={m.staff_saved_toast()}
							>
								{#snippet form()}
									<input {...edit.fields.id.as('hidden', s.id)} />
									<input {...edit.fields.sponsorId.as('hidden', sponsor.id)} />
									<SponsorshipFields fields={edit.fields} value={s} />
								{/snippet}
							</Action>
							<Action
								action={deleteSponsorship.for(s.id)}
								label={m.staff_delete_label()}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_delete_3_title({ title: s.title })}
								submitLabel={m.staff_delete_label()}
								submitVariant="error"
								successToast={m.staff_deleted_toast()}
							>
								{#snippet form()}
									<input {...deleteSponsorship.for(s.id).fields.id.as('hidden', s.id)} />
									<input
										{...deleteSponsorship.for(s.id).fields.sponsorId.as('hidden', sponsor.id)}
									/>
									<p class="text-sm">
										{m.staff_sponsors_id_row_should_never_have_existed_text()}
									</p>
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_sponsors_id_event_placements_title()}>
		{#if sponsor.placements.length === 0}
			<EmptyState
				title={m.staff_sponsors_id_not_placed_any_show_title()}
				description={m.staff_sponsors_id_place_sponsorship_credit_them_event_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_show_label()}</th>
					<th class="col-support">{m.staff_sponsors_id_sponsorship_label()}</th>
					<th>{m.staff_sponsors_id_credited_label()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
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
							{#if p.onEventPage}<Badge variant="outline" size="sm"
									>{m.staff_event_page_label()}</Badge
								>{/if}
							{#if p.inCampaign}<Badge variant="outline" size="sm">{m.staff_email_label()}</Badge
								>{/if}
						</td>
						<td class="w-px">
							<Action
								action={removePlacement.for(p.id)}
								label={m.staff_remove_label()}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_sponsors_id_stop_crediting_them_title({
									eventTitle: p.eventTitle
								})}
								submitLabel={m.staff_remove_label()}
								submitVariant="error"
								successToast={m.staff_removed_toast()}
							>
								{#snippet form()}
									<input {...removePlacement.for(p.id).fields.id.as('hidden', p.id)} />
									<input {...removePlacement.for(p.id).fields.sponsorId.as('hidden', sponsor.id)} />
									<p class="text-sm">
										{m.staff_sponsors_id_emails_already_sent_keep_credit_text()}
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
		{#if !sponsor.deletedAt}
			<Action
				action={archiveSponsor.for(sponsor.id)}
				label={m.staff_sponsors_id_archive_sponsor_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_archive_2_title({ name: sponsor.name })}
				submitLabel={m.staff_archive_label()}
				successToast={m.staff_archived_toast()}
			>
				{#snippet form()}
					<input {...archiveSponsor.for(sponsor.id).fields.id.as('hidden', sponsor.id)} />
					<p class="text-sm">
						{m.staff_sponsors_id_comes_off_sponsor_list_its_text()}
					</p>
				{/snippet}
			</Action>
		{/if}
		{#if sponsor.sponsorships.length === 0}
			<Action
				action={deleteSponsor.for(sponsor.id)}
				label={m.staff_sponsors_id_delete_sponsor_label()}
				variant="ghost"
				size="sm"
				class="text-error"
				modalTitle={m.staff_delete_2_title({ name: sponsor.name })}
				submitLabel={m.staff_delete_label()}
				submitVariant="error"
				successToast={m.staff_deleted_toast()}
				onsuccess={() => goto(resolve('staff/sponsors'))}
			>
				{#snippet form()}
					<input {...deleteSponsor.for(sponsor.id).fields.id.as('hidden', sponsor.id)} />
					<p class="text-sm">{m.staff_sponsors_id_row_should_never_have_existed_2_text()}</p>
				{/snippet}
			</Action>
		{/if}
	</div>
</PageContent>
