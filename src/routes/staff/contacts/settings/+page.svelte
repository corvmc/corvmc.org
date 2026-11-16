<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { getContactsSettings, updateContactsTaskPositions } from '#lib/remote/settings.remote.js';

	// Contacts' own settings (#2940): the position on lapsing contractor insurance tasks.
	const settings = $derived(await getContactsSettings());
	const options = $derived([
		{ value: '', label: m.staff_settings_none_label() },
		...settings.positions.map((p) => ({ value: p.id, label: p.name }))
	]);
</script>

<PageHeader width="2xl" title={m.staff_contacts_settings_title()} />

<PageContent width="2xl">
	<Form remote={updateContactsTaskPositions} successToast={m.staff_task_positions_saved_toast()}>
		<Card>
			<CardBody>
				<div class="flex items-center justify-between">
					<CardTitle size="base">{m.staff_task_positions_title()}</CardTitle>
					<SubmitButton
						label={m.staff_settings_save_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
						size="sm"
					/>
				</div>
				<p class="text-subtle">{m.staff_task_positions_text()}</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateContactsTaskPositions.fields.insurancePositionId}
						label={m.staff_contacts_settings_insurance_position_label()}
						type="select"
						value={settings.insurancePositionId}
						{options}
					/>
				</div>
			</CardBody>
		</Card>
	</Form>
</PageContent>
