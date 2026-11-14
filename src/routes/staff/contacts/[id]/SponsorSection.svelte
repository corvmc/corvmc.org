<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * A sponsor's logo, sponsorships and event placements on its organization
	 * page (#2764), behind `sponsor.read`. Funding links here at `#sponsorships`.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import SponsorshipFields from '#lib/components/sponsor/SponsorshipFields.svelte';
	import PlacementFields from '#lib/components/sponsor/PlacementFields.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		getSponsorDetail,
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
	import { resolve } from '$app/paths';

	let { id }: { id: string } = $props();

	const sponsor = $derived(await getSponsorDetail(id));
	const lapsed = $derived(sponsor.sponsorships.find((s) => s.deadline?.overdue));
</script>

{#if lapsed}
	<Alert type="warning">
		{m.staff_sponsors_id_ended_renew_with_new_sponsorship_body({
			title: lapsed.title,
			formatIsoDay: formatIsoDay(lapsed.endsOn)
		})}
	</Alert>
{/if}

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

<!-- Funding and old sponsor links land here. -->
<div id="sponsorships" class="scroll-mt-4"></div>
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
				<SponsorshipFields fields={createSponsorship.fields} projects={sponsor.projects} />
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
						{#if s.projectId}
							<a
								class="link font-medium"
								href={resolve('/staff/tasks/projects/[id]', { id: s.projectId })}>{s.title}</a
							>
						{:else}
							<span class="font-medium">{s.title}</span>
						{/if}
						{#if s.tier}<div class="text-muted">{s.tier}</div>{/if}
						{#if s.nextTask}
							<div class="truncate text-muted">
								{m.staff_sponsors_id_next_task_text({ title: s.nextTask.title })}
							</div>
						{/if}
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
									<input {...placeSponsorship.for(s.id).fields.sponsorshipId.as('hidden', s.id)} />
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
								<SponsorshipFields fields={edit.fields} projects={sponsor.projects} value={s} />
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
								<input {...deleteSponsorship.for(s.id).fields.sponsorId.as('hidden', sponsor.id)} />
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
