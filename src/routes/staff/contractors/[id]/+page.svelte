<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { workOrderPathname } from '#lib/utils/work-order-href.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { ActivityFeed } from '#lib/components/ui/ActivityFeed/index.js';
	import { FEED_PAGE } from '#lib/types/activity.js';
	import { withHash } from '#lib/utils/with-query.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		getContractorDetail,
		updateContractorForm,
		archiveContractorForm
	} from '#lib/remote/contractors.remote.js';
	import {
		contractorTradeLabels,
		contractorTrades,
		contractorJobStatusBadge,
		contractorJobStatusLabels,
		type ContractorTrade,
		type ContractorJobStatus
	} from '#lib/config.js';
	import { formatCents, formatDateShort, toLocalDate } from '#lib/utils/format.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * One contractor, and everything they have ever done for us.
	 *
	 * The job history is the reason the table exists at all — "when were they
	 * last in" is unanswerable from a free-text name — so it is the body of the
	 * page rather than a panel on it.
	 */
	const data = $derived(await getContractorDetail(page.params.id!));
	const { fields } = updateContractorForm;
	const archiveFields = archiveContractorForm.fields;

	// Every job is already in the page's one query; "Show older" only reveals more of it.
	let shown = $state(FEED_PAGE);
	const jobRows = $derived(
		data.jobs
			.map(({ job, itemName, assetTag }) => ({
				id: job.id,
				at: job.completedAt ?? job.scheduledFor ?? job.createdAt,
				summary: job.title,
				href: withHash(
					resolve(workOrderPathname({ id: job.workOrderId, projectId: job.projectId })),
					`engagement-${job.id}`
				),
				context: itemName ? { label: assetTag ? `${itemName} · ${assetTag}` : itemName } : null,
				job
			}))
			.sort((a, b) => b.at.getTime() - a.at.getTime())
	);

	const tradeOptions = contractorTrades.map((t) => ({
		value: t,
		label: contractorTradeLabels[t]
	}));
</script>

<PageHeader
	title={data.contractor.name}
	subtitle={contractorTradeLabels[data.contractor.trade as ContractorTrade]}
>
	<Action
		action={updateContractorForm}
		label={m.staff_edit()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2({ name: data.contractor.name })}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', data.contractor.id)} />
			<Field field={fields.name} type="text" label={m.staff_name()} value={data.contractor.name} />
			<Field
				field={fields.trade}
				type="select"
				label={m.staff_trade()}
				options={tradeOptions}
				value={data.contractor.trade}
			/>
			<Field
				field={fields.contactName}
				type="text"
				label={m.staff_contact()}
				value={data.contractor.contactName ?? ''}
			/>
			<Field
				field={fields.phone}
				type="tel"
				label={m.staff_phone()}
				value={data.contractor.phone ?? ''}
			/>
			<Field
				field={fields.email}
				type="email"
				label={m.staff_email()}
				value={data.contractor.email ?? ''}
			/>
			<Field
				field={fields.licenseNumber}
				type="text"
				label={m.staff_licence_number()}
				value={data.contractor.licenseNumber ?? ''}
			/>
			<Field
				field={fields.insuranceExpiresAt}
				type="date"
				label={m.staff_insurance_expires()}
				description={m.staff_contractors_id_leave_blank_if_we_hold()}
				value={data.contractor.insuranceExpiresAt
					? toLocalDate(data.contractor.insuranceExpiresAt)
					: ''}
			/>
			<Field
				field={fields.notes}
				type="textarea"
				label={m.staff_notes()}
				value={data.contractor.notes ?? ''}
			/>
		{/snippet}
	</Action>

	<Action
		action={archiveContractorForm}
		label={data.contractor.archivedAt ? m.staff_contractors_id_bring_back() : m.staff_archive()}
		variant="ghost"
		size="sm"
		modalTitle={data.contractor.archivedAt
			? m.staff_contractors_id_bring_back()
			: m.staff_archive()}
		successToast={m.staff_saved()}
	>
		{#snippet form()}
			<input {...archiveFields.id.as('hidden', data.contractor.id)} />
			<!--
				A real boolean, not the string: `as('hidden', …)` is typed to the
				field. Unchecked booleans are never submitted, which is why the
				schema defaults to false — so the un-archive case works whether the
				`false` reaches the server or is filled in by the default.
			-->
			<input {...archiveFields.archived.as('hidden', !data.contractor.archivedAt)} />
			<p class="text-sm">
				{#if data.contractor.archivedAt}
					{m.staff_contractors_id_they_will_show_pickers_again()}
				{:else}
					{m.staff_contractors_id_they_stay_out_pickers_no()}
				{/if}
			</p>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if data.contractor.archivedAt}
		<Alert type="info">
			<ParaglideMessage
				message={m.staff_contractors_id_archived_history_below_stays}
				inputs={{
					staff_archived: m.staff_archived(),
					formatDateShort: formatDateShort(data.contractor.archivedAt)
				}}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	{#if data.contractor.insuranceExpiresAt && data.contractor.insuranceExpiresAt < new Date()}
		<Alert type="error">
			<ParaglideMessage
				message={m.staff_contractors_id_their_certificate_ran_out}
				inputs={{
					staff_contractors_id_insurance_expired: m.staff_contractors_id_insurance_expired(),
					formatDateShort: formatDateShort(data.contractor.insuranceExpiresAt)
				}}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	<InfoCard title={m.staff_details()}>
		<dl class="grid gap-3 sm:grid-cols-2">
			<div>
				<dt class="text-subtle text-xs">{m.staff_contact()}</dt>
				<dd>{data.contractor.contactName ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_phone()}</dt>
				<dd>{data.contractor.phone ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_email()}</dt>
				<dd>{data.contractor.email ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_contractors_id_licence()}</dt>
				<dd>{data.contractor.licenseNumber ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_insurance()}</dt>
				<dd>
					{#if data.contractor.insuranceExpiresAt}
						{formatDateShort(data.contractor.insuranceExpiresAt)}
					{:else}
						<span class="text-subtle">{m.staff_not_file()}</span>
					{/if}
				</dd>
			</div>
		</dl>
		{#if data.contractor.notes}
			<p class="mt-4 text-sm">{data.contractor.notes}</p>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_jobs()}>
		<ActivityFeed
			label={m.staff_jobs()}
			rows={jobRows.slice(0, shown)}
			hasMore={jobRows.length > shown}
			onmore={() => (shown += FEED_PAGE)}
			empty={{
				title: m.staff_contractors_id_no_jobs_yet(),
				description: m.staff_contractors_id_nothing_has_been_sent_them()
			}}
		>
			{#snippet trailing({ job })}
				<Badge variant={contractorJobStatusBadge[job.status as ContractorJobStatus]} size="sm">
					{contractorJobStatusLabels[job.status as ContractorJobStatus]}
				</Badge>
				{#if job.costCents != null}
					<div class="text-muted text-xs">{formatCents(job.costCents)}</div>
				{/if}
			{/snippet}
		</ActivityFeed>
	</InfoCard>
</PageContent>
