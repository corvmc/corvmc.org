<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { applyToGroups } from '$lib/remote/group-applications.remote';
	import { groupApplicationQuestions, APPLICATION_ANSWER_MAX } from '$lib/config';

	/**
	 * One application can name several committees, so this is one dialog for
	 * every committee row, opened with the row's committee ticked.
	 */
	let {
		open = $bindable(false),
		committees,
		selectedId,
		onclose
	}: {
		open?: boolean;
		committees: { id: string; name: string; bio: string | null }[];
		selectedId: string | null;
		onclose?: () => void;
	} = $props();

	const fields = applyToGroups.fields;

	const questionPrompt = (id: string) =>
		groupApplicationQuestions.committee.find((q) => q.id === id)?.prompt ?? id;
</script>

<Modal title={m.member_groups_committee_apply_modal_title()} bind:open {onclose}>
	<Form
		remote={applyToGroups}
		successToast={m.member_application_sent()}
		onsuccess={() => (open = false)}
		class="space-y-6"
	>
		<!-- Keyed so reopening from another row ticks that row's committee. -->
		{#key selectedId}
			<CheckboxGroup
				field={fields.groupIds}
				legend={m.member_groups_committee_apply_modal_legend()}
				options={committees.map((c) => ({ value: c.id, label: c.name, description: c.bio }))}
				selected={selectedId ? [selectedId] : []}
			/>
		{/key}

		<!-- Named rather than looped: `fields` is typed per key, so an index
		     into it is `any`. config.spec.ts pins the two lists together. -->
		<FormField
			field={fields.experience}
			type="textarea"
			label={questionPrompt('experience')}
			maxlength={String(APPLICATION_ANSWER_MAX)}
		/>
		<FormField
			field={fields.vision}
			type="textarea"
			label={questionPrompt('vision')}
			maxlength={String(APPLICATION_ANSWER_MAX)}
		/>

		<Alert type="info">{m.member_groups_committee_apply_modal_chair_will_contact_accou()}</Alert>

		<div class="flex justify-end">
			<SubmitButton label={m.member_send_application()} />
		</div>
	</Form>
</Modal>
