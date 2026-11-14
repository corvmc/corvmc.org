<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Grant applications and sponsorships together, by stage, what needs doing next first. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import GrantFields from '#lib/components/grant/GrantFields.svelte';
	import SponsorshipFields from '#lib/components/sponsor/SponsorshipFields.svelte';
	import { getFunding } from '#lib/remote/funding.remote.js';
	import { createGrant } from '#lib/remote/grants.remote.js';
	import { createSponsorship } from '#lib/remote/sponsors.remote.js';
	import {
		fundingStages,
		grantDeadlineLabels,
		grantStatusBadge,
		grantStatusLabels,
		projectKindLabels,
		sponsorshipStatusBadge,
		sponsorshipStatusLabels,
		type FundingStage
	} from '#lib/config.js';
	import { formatCents, formatDateShort } from '#lib/utils/format.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { resolve } from '$app/paths';
	import { withHash, withQuery } from '#lib/utils/with-query.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const stageTitles: Record<FundingStage, string> = {
		prospect: m.staff_funding_prospect_title(),
		applied: m.staff_funding_applied_title(),
		active: m.staff_funding_active_title(),
		closed: m.staff_funding_closed_title()
	};

	const includeClosed = $derived(page.url.searchParams.get('closed') === '1');
	const data = $derived(await getFunding({ includeClosed }));
	const groups = $derived(
		fundingStages
			.map((stage) => ({ stage, rows: data.rows.filter((r) => r.stage === stage) }))
			.filter((g) => g.rows.length > 0)
	);

	function setClosed(on: boolean) {
		const url = new URL(page.url.href);
		if (on) url.searchParams.set('closed', '1');
		else url.searchParams.delete('closed');
		goto(url, { replace: true, reset: false });
	}

	type Row = (typeof data.rows)[number];
	const hrefOf = (r: Row) =>
		r.kind === 'grant'
			? resolve('/staff/grants/[id]', { id: r.id })
			: withHash(resolve('/staff/contacts/[id]', { id: r.organizationId }), 'sponsorships');
	const badgeOf = (r: Row) =>
		r.kind === 'grant'
			? { variant: grantStatusBadge[r.status], label: grantStatusLabels[r.status] }
			: { variant: sponsorshipStatusBadge[r.status], label: sponsorshipStatusLabels[r.status] };
	const sponsorOptions = $derived(data.sponsors.map((s) => ({ value: s.id, label: s.name })));
</script>

<PageHeader title={m.staff_funding_title()}>
	{#if data.shows.grants}
		<Button href={withQuery(resolve('staff/contacts'), 'role=funder')} variant="ghost" size="sm">
			{m.staff_funders_label()}
		</Button>
	{/if}
	{#if data.shows.sponsors}
		<Button href={withQuery(resolve('staff/contacts'), 'role=sponsor')} variant="ghost" size="sm">
			{m.staff_sponsors_sponsors_label()}
		</Button>
	{/if}
	{#if data.canCreate.sponsors && data.sponsors.length > 0}
		<Action
			action={createSponsorship}
			label={m.staff_sponsors_id_add_sponsorship_label()}
			variant="ghost"
			modalTitle={m.staff_sponsors_id_new_sponsorship_title()}
			submitLabel={m.staff_add_label()}
			successToast={m.staff_sponsors_id_sponsorship_added_toast()}
			onsuccess={() => void getFunding({ includeClosed }).refresh()}
			data-testid="new-sponsorship"
		>
			{#snippet form()}
				<Field
					field={createSponsorship.fields.sponsorId}
					type="select"
					label={m.staff_funding_sponsor_label()}
					options={sponsorOptions}
					value={data.sponsors[0]?.id ?? ''}
				/>
				<SponsorshipFields fields={createSponsorship.fields} projects={data.projects} />
			{/snippet}
		</Action>
	{/if}
	{#if data.canCreate.grants && data.funders.length > 0}
		<Action
			action={createGrant}
			label={m.staff_grants_label()}
			modalTitle={m.staff_grants_modal_title()}
			submitLabel={m.staff_grants_submit_label()}
			successToast={m.staff_grants_success_toast()}
			onsuccess={(r) => {
				const id = (r as { id?: string } | undefined)?.id;
				if (id) goto(resolve('/staff/grants/[id]', { id }));
			}}
			data-testid="new-grant"
		>
			{#snippet form()}
				<GrantFields fields={createGrant.fields} funders={data.funders} projects={data.projects} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	<div class="flex justify-end">
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={includeClosed}
				onchange={(e) => setClosed(e.currentTarget.checked)}
			/>
			{m.staff_grants_show_closed_label()}
		</label>
	</div>

	{#if groups.length === 0}
		<EmptyState title={m.staff_funding_empty_title()} description={m.staff_funding_empty_body()} />
	{/if}

	{#each groups as group (group.stage)}
		<InfoCard title={stageTitles[group.stage]}>
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
					<th>{m.staff_grants_application_label()}</th>
					<th>{m.staff_grants_id_next_task_label()}</th>
					<th class="col-support">{m.staff_grants_next_deadline_label()}</th>
					<th class="col-support cell-num">{m.staff_amount_label()}</th>
				{/snippet}
				{#each group.rows as r (r.kind + r.id)}
					{@const badge = badgeOf(r)}
					<tr data-funding-kind={r.kind}>
						<td class="w-px">
							<Badge variant={badge.variant} size="sm">{badge.label}</Badge>
						</td>
						<td class="cell-primary">
							<a class="link font-medium" href={hrefOf(r)}>{r.organizationName}</a>
							<div class="truncate text-muted">
								{projectKindLabels[r.kind]} · {r.title}
							</div>
						</td>
						<td>
							{#if r.nextTask && r.projectId}
								<a class="link" href={resolve('/staff/tasks/projects/[id]', { id: r.projectId })}>
									{r.nextTask.title}
								</a>
								{#if r.nextTask.dueAt}
									<div class="text-muted">{formatDateShort(r.nextTask.dueAt)}</div>
								{/if}
							{:else if r.kind === 'grant' && r.status === 'applied'}
								<span class="text-muted">{m.staff_grants_awaiting_decision_text()}</span>
							{:else}
								—
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{#if r.deadline}
								<span class:text-error={r.deadline.overdue}>
									{r.kind === 'grant'
										? grantDeadlineLabels[r.deadline.kind as keyof typeof grantDeadlineLabels]
										: m.staff_funding_term_ends_text()}
									{formatIsoDay(r.deadline.on)}
								</span>
							{:else}
								—
							{/if}
						</td>
						<td class="col-support cell-num">
							{#if r.amountCents == null}
								—
							{:else if r.asked}
								<span class="text-muted"
									>{m.staff_grants_asked_text({ formatCents: formatCents(r.amountCents) })}</span
								>
							{:else}
								{formatCents(r.amountCents)}
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		</InfoCard>
	{/each}
</PageContent>
