<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		getContractorDetail,
		updateContractorForm,
		archiveContractorForm
	} from '#lib/remote/contractors.remote.js';
	import { contractorTradeLabels, contractorTrades, type ContractorTrade } from '#lib/config.js';
	import { formatDateShort, toLocalDate } from '#lib/utils/format.js';
	import RelatedTasks from '#lib/components/task/RelatedTasks.svelte';
	import RelatedShifts from '#lib/components/volunteer/RelatedShifts.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	/** One contractor: their details, and the tasks they are engaged on. */
	const data = $derived(await getContractorDetail(params.id));
	const { fields } = updateContractorForm;
	const archiveFields = archiveContractorForm.fields;

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
		label={m.staff_edit_label()}
		variant="ghost"
		size="sm"
		modalTitle={m.staff_edit_2_title({ name: data.contractor.name })}
		successToast={m.staff_saved_toast()}
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', data.contractor.id)} />
			<Field
				field={fields.name}
				type="text"
				label={m.staff_name_label()}
				value={data.contractor.name}
			/>
			<Field
				field={fields.trade}
				type="select"
				label={m.staff_trade_label()}
				options={tradeOptions}
				value={data.contractor.trade}
			/>
			<Field
				field={fields.contactName}
				type="text"
				label={m.staff_contact_label()}
				value={data.contractor.contactName ?? ''}
			/>
			<Field
				field={fields.phone}
				type="tel"
				label={m.staff_phone_label()}
				value={data.contractor.phone ?? ''}
			/>
			<Field
				field={fields.email}
				type="email"
				label={m.staff_email_label()}
				value={data.contractor.email ?? ''}
			/>
			<Field
				field={fields.licenseNumber}
				type="text"
				label={m.staff_licence_number_label()}
				value={data.contractor.licenseNumber ?? ''}
			/>
			<Field
				field={fields.insuranceExpiresAt}
				type="date"
				label={m.staff_insurance_expires_label()}
				description={m.staff_contractors_id_leave_blank_if_we_hold_body()}
				value={data.contractor.insuranceExpiresAt
					? toLocalDate(data.contractor.insuranceExpiresAt)
					: ''}
			/>
			<Field
				field={fields.notes}
				type="textarea"
				label={m.staff_notes_label()}
				value={data.contractor.notes ?? ''}
			/>
		{/snippet}
	</Action>

	<Action
		action={archiveContractorForm}
		label={data.contractor.archivedAt
			? m.staff_contractors_id_bring_back_label()
			: m.staff_archive_label()}
		variant="ghost"
		size="sm"
		modalTitle={data.contractor.archivedAt
			? m.staff_contractors_id_bring_back_title()
			: m.staff_archive_title()}
		successToast={m.staff_saved_toast()}
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
					{m.staff_contractors_id_they_will_show_pickers_again_text()}
				{:else}
					{m.staff_contractors_id_they_stay_out_pickers_no_text()}
				{/if}
			</p>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if data.contractor.archivedAt}
		<Alert type="info">
			<ParaglideMessage
				message={m.staff_contractors_id_archived_history_below_stays_body}
				inputs={{
					staff_archived: m.staff_archived_body(),
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
				message={m.staff_contractors_id_their_certificate_ran_out_body}
				inputs={{
					staff_contractors_id_insurance_expired: m.staff_contractors_id_insurance_expired_body(),
					formatDateShort: formatDateShort(data.contractor.insuranceExpiresAt)
				}}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	<InfoCard title={m.staff_details_title()}>
		<dl class="grid gap-3 sm:grid-cols-2">
			<div>
				<dt class="text-subtle text-xs">{m.staff_contact_label()}</dt>
				<dd>{data.contractor.contactName ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_phone_label()}</dt>
				<dd>{data.contractor.phone ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_email_label()}</dt>
				<dd>{data.contractor.email ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_contractors_id_licence_label()}</dt>
				<dd>{data.contractor.licenseNumber ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-subtle text-xs">{m.staff_insurance_label()}</dt>
				<dd>
					{#if data.contractor.insuranceExpiresAt}
						{formatDateShort(data.contractor.insuranceExpiresAt)}
					{:else}
						<span class="text-subtle">{m.staff_not_file_text()}</span>
					{/if}
				</dd>
			</div>
		</dl>
		{#if data.contractor.notes}
			<p class="mt-4 text-sm">{data.contractor.notes}</p>
		{/if}
	</InfoCard>

	<RelatedTasks subject={{ type: 'organization', id: data.contractor.id }} />
	<RelatedShifts subject={{ type: 'organization', id: data.contractor.id }} />
</PageContent>
