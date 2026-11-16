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
	import { getGearSettings, updateGearTaskPositions } from '#lib/remote/settings.remote.js';

	// Gear's own settings (#2756, #2940): the position on the tasks it opens.
	const settings = $derived(await getGearSettings());
	const options = $derived([
		{ value: '', label: m.staff_settings_none_label() },
		...settings.positions.map((p) => ({ value: p.id, label: p.name }))
	]);
</script>

<PageHeader width="2xl" title={m.staff_gear_settings_title()} />

<PageContent width="2xl">
	<Form remote={updateGearTaskPositions} successToast={m.staff_task_positions_saved_toast()}>
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
						field={updateGearTaskPositions.fields.repairPositionId}
						label={m.staff_gear_settings_repair_position_label()}
						type="select"
						value={settings.repairPositionId}
						{options}
					/>
					<FormField
						field={updateGearTaskPositions.fields.restockPositionId}
						label={m.staff_gear_settings_restock_position_label()}
						type="select"
						value={settings.restockPositionId}
						{options}
					/>
					<FormField
						field={updateGearTaskPositions.fields.lateOrderPositionId}
						label={m.staff_gear_settings_late_order_position_label()}
						type="select"
						value={settings.lateOrderPositionId}
						{options}
					/>
					<FormField
						field={updateGearTaskPositions.fields.form8282PositionId}
						label={m.staff_gear_settings_form_8282_position_label()}
						type="select"
						value={settings.form8282PositionId}
						{options}
					/>
				</div>
			</CardBody>
		</Card>
	</Form>
</PageContent>
