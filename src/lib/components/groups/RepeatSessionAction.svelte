<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { repeatGroupSession } from '$lib/remote/group-events.remote';

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
		{ value: 'weekly', label: 'Every week' },
		{ value: 'biweekly', label: 'Every other week' },
		{ value: 'monthly', label: 'Every month' }
	];

	const monthlyModeOptions = [
		{ value: 'weekday', label: 'Same weekday of the month' },
		{ value: 'monthday', label: 'Same date each month' }
	];
</script>

<Action
	action={repeatGroupSession.for(session.id)}
	label="Repeat"
	aria-label={`Make ${session.title} repeat`}
	modalTitle="Repeat this session"
	submitLabel="Repeat"
	successToast="Session repeats"
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
				label="How often"
				options={frequencyOptions}
				bind:value={frequency}
				required
			/>

			{#if frequency === 'monthly'}
				<FormField
					field={fields.monthlyMode}
					type="select"
					label="Which day"
					options={monthlyModeOptions}
					value="weekday"
				/>
			{/if}

			<FormField
				field={fields.recurringEndsAt}
				type="date"
				label="Until"
				description="Optional. Leave empty to keep going."
			/>

			<p class="text-subtle">
				The following sessions go up automatically, each one published and holding the same room. If
				a later date is already booked, that session still goes up without the room.
			</p>
		</div>
	{/snippet}
</Action>
