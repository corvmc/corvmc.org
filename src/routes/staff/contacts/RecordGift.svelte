<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { getGiftProjects, recordGiftForm } from '#lib/remote/contacts.remote.js';
	import { toLocalDate } from '#lib/utils/format.js';

	/** Records an in-kind gift from this party as a ledger entry (#2727). */
	let { party }: { party: { type: 'organization' | 'contact'; id: string } } = $props();

	const projects = $derived(await getGiftProjects());
	const projectOptions = $derived([
		{ value: '', label: m.staff_contacts_no_project_label() },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
</script>

<Action
	action={recordGiftForm}
	label={m.staff_contacts_record_gift_label()}
	modalTitle={m.staff_contacts_record_gift_title()}
	successToast={m.staff_contacts_gift_recorded_toast()}
	variant="ghost"
	size="sm"
	data-testid="record-gift"
>
	{#snippet form()}
		<input {...recordGiftForm.fields.partyType.as('hidden', party.type)} />
		<input {...recordGiftForm.fields.partyId.as('hidden', party.id)} />
		<Field
			field={recordGiftForm.fields.description}
			type="text"
			label={m.staff_description_label()}
		/>
		<MoneyField
			field={recordGiftForm.fields.valueCents}
			label={m.staff_contacts_fair_value_label()}
		/>
		<Field
			field={recordGiftForm.fields.occurredOn}
			type="date"
			label={m.staff_date_label()}
			value={toLocalDate(new Date())}
		/>
		<Field
			field={recordGiftForm.fields.projectId}
			type="select"
			label={m.staff_project_label()}
			options={projectOptions}
			value=""
		/>
	{/snippet}
</Action>
