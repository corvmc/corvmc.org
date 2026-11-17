<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getTrainingShifts, grantCertification } from '#lib/remote/volunteer.remote.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import { Latest } from '#lib/latest.svelte.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';

	/**
	 * The member's supervised shifts that count towards the chosen clearance
	 * (#2720), offered as evidence on the grant. Its own query, so it loads only
	 * once the grant modal is open.
	 */
	let { userId }: { userId: string } = $props();

	const shifts = new Latest(() => getTrainingShifts(userId));

	const chosen = $derived(grantCertification.fields.certificationId.value() ?? '');
	const matching = $derived(
		(shifts.current ?? []).filter((s) => s.certificationIds.includes(chosen))
	);
</script>

{#if matching.length > 0}
	<FormField
		field={grantCertification.fields.trainingSignupId}
		label={m.staff_members_id_panels_grant_certification_training_shift_label()}
		type="select"
		options={[
			{ value: '', label: m.staff_members_id_panels_grant_certification_no_training_shift_label() },
			...matching.map((s) => ({
				value: s.signupId,
				label: `${s.roleName} · ${formatDateShortYear(s.startsAt)} · ${s.supervisorName}`
			}))
		]}
	/>
{:else if shifts.error}
	<Alert type="warning" reset={() => void getTrainingShifts(userId).refresh()}>
		{m.ui_load_failed_body({ error: errorMessage(shifts.error.e) })}
	</Alert>
{/if}
