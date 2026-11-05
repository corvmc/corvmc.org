<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { repeatGroupSession } from '#lib/remote/group-events.remote.js';

	/**
	 * Make an existing one-off session repeat. The same repeat block the create
	 * form has, for a session that was put up once and turned out to be regular.
	 */
	let {
		groupId,
		session,
		onchanged
	}: { groupId: string; session: { id: string; title: string }; onchanged: () => void } = $props();

	const fields = repeatGroupSession.fields;

	let frequency = $state('');

	const frequencyOptions = [
		{ value: 'weekly', label: m.groups_every_week() },
		{ value: 'biweekly', label: m.groups_every_other_week() },
		{ value: 'monthly', label: m.groups_every_month() }
	];

	const monthlyModeOptions = [
		{ value: 'weekday', label: m.groups_same_weekday_month() },
		{ value: 'monthday', label: m.groups_same_date_each_month() }
	];
</script>

<Action
	action={repeatGroupSession.for(session.id)}
	label={m.groups_repeat_session_repeat()}
	aria-label={m.groups_repeat_session_aria_label({ title: session.title })}
	modalTitle={m.groups_repeat_session_modal_title()}
	submitLabel={m.groups_repeat_session_repeat()}
	successToast={m.groups_repeat_session_success_toast()}
	variant="ghost"
	size="xs"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<input {...fields.eventId.as('hidden', session.id)} />

			<FormField
				field={fields.recurringFrequency}
				type="select"
				label={m.groups_how_often()}
				options={frequencyOptions}
				bind:value={frequency}
				required
			/>

			{#if frequency === 'monthly'}
				<FormField
					field={fields.monthlyMode}
					type="select"
					label={m.groups_which_day()}
					options={monthlyModeOptions}
					value="weekday"
				/>
			{/if}

			<FormField
				field={fields.recurringEndsAt}
				type="date"
				label={m.groups_until()}
				description={m.groups_optional_leave_empty_keep_going()}
			/>

			<p class="text-subtle">
				{m.groups_repeat_session_following_sessions_go_up_automatically()}
			</p>
		</div>
	{/snippet}
</Action>
