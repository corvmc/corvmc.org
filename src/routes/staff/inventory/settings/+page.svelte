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
	import { getGearSettings, updateGearTaskRoles } from '#lib/remote/settings.remote.js';

	// Gear's own settings (#2756): the role on the tasks it opens.
	const settings = $derived(await getGearSettings());
	const options = $derived([
		{ value: '', label: m.staff_settings_none_label() },
		...settings.roles.map((r) => ({ value: r.id, label: r.name }))
	]);
</script>

<PageHeader width="2xl" title={m.staff_gear_settings_title()} />

<PageContent width="2xl">
	<Form remote={updateGearTaskRoles} successToast={m.staff_gear_settings_saved_toast()}>
		<Card>
			<CardBody>
				<div class="flex items-center justify-between">
					<CardTitle size="base">{m.staff_gear_settings_task_roles_title()}</CardTitle>
					<SubmitButton
						label={m.staff_settings_save_label()}
						successLabel={m.staff_settings_saved_label()}
						errorLabel={m.staff_settings_error_label()}
						variant="primary"
						size="sm"
					/>
				</div>
				<p class="text-subtle">{m.staff_gear_settings_task_roles_text()}</p>

				<div class="mt-2 grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateGearTaskRoles.fields.repairRoleId}
						label={m.staff_gear_settings_repair_role_label()}
						type="select"
						value={settings.repairRoleId}
						{options}
					/>
					<FormField
						field={updateGearTaskRoles.fields.restockRoleId}
						label={m.staff_gear_settings_restock_role_label()}
						type="select"
						value={settings.restockRoleId}
						{options}
					/>
					<FormField
						field={updateGearTaskRoles.fields.lateOrderRoleId}
						label={m.staff_gear_settings_late_order_role_label()}
						type="select"
						value={settings.lateOrderRoleId}
						{options}
					/>
					<FormField
						field={updateGearTaskRoles.fields.form8282RoleId}
						label={m.staff_gear_settings_form_8282_role_label()}
						type="select"
						value={settings.form8282RoleId}
						{options}
					/>
				</div>
			</CardBody>
		</Card>
	</Form>
</PageContent>
