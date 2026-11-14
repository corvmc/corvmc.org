<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/** A contractor's own fields on its organization page (#2764), behind `contractor.read`. */
	import Alert from '#lib/components/ui/Alert.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { getContractorDetail, updateContractorForm } from '#lib/remote/contractors.remote.js';
	import { contractorTradeLabels, contractorTrades, type ContractorTrade } from '#lib/config.js';
	import { formatDateShort, toLocalDate } from '#lib/utils/format.js';

	let { id, canManage }: { id: string; canManage: boolean } = $props();

	const data = $derived(await getContractorDetail(id));
	const c = $derived(data.contractor);
	const { fields } = updateContractorForm;

	const tradeOptions = contractorTrades.map((t) => ({
		value: t,
		label: contractorTradeLabels[t]
	}));
</script>

{#if c.insuranceExpiresAt && c.insuranceExpiresAt < new Date()}
	<Alert type="error">
		<ParaglideMessage
			message={m.staff_contractors_id_their_certificate_ran_out_body}
			inputs={{
				staff_contractors_id_insurance_expired: m.staff_contractors_id_insurance_expired_body(),
				formatDateShort: formatDateShort(c.insuranceExpiresAt)
			}}
			>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
				>{/snippet}</ParaglideMessage
		>
	</Alert>
{/if}

<InfoCard title={m.staff_contacts_contractor_details_title()}>
	{#snippet action()}
		{#if canManage}
			<Action
				action={updateContractorForm}
				label={m.staff_edit_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_edit_2_title({ name: c.name })}
				successToast={m.staff_saved_toast()}
			>
				{#snippet form()}
					<input {...fields.id.as('hidden', c.id)} />
					<Field field={fields.name} type="text" label={m.staff_name_label()} value={c.name} />
					<Field
						field={fields.trade}
						type="select"
						label={m.staff_trade_label()}
						options={tradeOptions}
						value={c.trade}
					/>
					<Field
						field={fields.contactName}
						type="text"
						label={m.staff_contact_label()}
						value={c.contactName ?? ''}
					/>
					<Field
						field={fields.phone}
						type="tel"
						label={m.staff_phone_label()}
						value={c.phone ?? ''}
					/>
					<Field
						field={fields.email}
						type="email"
						label={m.staff_email_label()}
						value={c.email ?? ''}
					/>
					<Field
						field={fields.website}
						type="text"
						label={m.staff_website_label()}
						value={c.website ?? ''}
					/>
					<Field
						field={fields.licenseNumber}
						type="text"
						label={m.staff_licence_number_label()}
						value={c.licenseNumber ?? ''}
					/>
					<Field
						field={fields.insuranceExpiresAt}
						type="date"
						label={m.staff_insurance_expires_label()}
						description={m.staff_contractors_id_leave_blank_if_we_hold_body()}
						value={c.insuranceExpiresAt ? toLocalDate(c.insuranceExpiresAt) : ''}
					/>
					<Field
						field={fields.notes}
						type="textarea"
						label={m.staff_notes_label()}
						value={c.notes ?? ''}
					/>
				{/snippet}
			</Action>
		{/if}
	{/snippet}
	<DefinitionList>
		<Fact label={m.staff_trade_label()} value={contractorTradeLabels[c.trade as ContractorTrade]} />
		<Fact label={m.staff_licence_number_label()} value={c.licenseNumber ?? '—'} />
		<Fact
			label={m.staff_insurance_label()}
			value={c.insuranceExpiresAt ? formatDateShort(c.insuranceExpiresAt) : m.staff_not_file_text()}
		/>
	</DefinitionList>
</InfoCard>
