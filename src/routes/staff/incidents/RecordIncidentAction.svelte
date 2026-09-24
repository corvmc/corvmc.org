<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { clubToday, incidentCategories, incidentCategoryLabels } from '$lib/config';
	import { recordIncidentForm } from '$lib/remote/incidents.remote';

	const { fields } = recordIncidentForm;
	const categoryOptions = incidentCategories.map((c) => ({
		value: c,
		label: incidentCategoryLabels[c]
	}));

	let involvedUserId = $state('');
	let involvedName = $state('');
</script>

<Action
	action={recordIncidentForm}
	label="Record incident"
	modalTitle="Record an incident"
	submitLabel="Record"
	successToast="Incident recorded"
	onsuccess={(result) => {
		involvedUserId = '';
		involvedName = '';
		const id = (result as { id?: string } | undefined)?.id;
		if (id) void goto(resolve(`/staff/incidents/${id}`));
	}}
>
	{#snippet form()}
		<div class="grid grid-cols-2 gap-3">
			<Field field={fields.occurredOn} type="date" label="Date" value={clubToday()} />
			<Field field={fields.occurredAt} type="time" label="Time" />
		</div>
		<Field field={fields.category} type="select" label="Kind" options={categoryOptions} />
		<Field
			field={fields.summary}
			type="text"
			label="Summary"
			description="One line — what the log shows."
		/>
		<Field
			field={fields.description}
			type="textarea"
			label="What happened"
			description="Written once. Anything learned later goes in as a note."
		/>
		<Field field={fields.location} type="text" label="Where" />
		<MemberPicker
			field={fields.involvedUserId}
			label="Member involved (optional)"
			bind:value={involvedUserId}
			bind:name={involvedName}
		/>
		<p class="text-muted text-wrap">
			Recording this changes nothing about the member's account, and they cannot see it.
		</p>
	{/snippet}
</Action>
