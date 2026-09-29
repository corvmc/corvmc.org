<script lang="ts">
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { updateStaffGroup } from '$lib/remote/groups.remote';
	import { invalidateAll } from '$app/navigation';

	/**
	 * How this program is found and joined. Two settings, one form, because they
	 * are the same decision from two sides: whether people can see it, and what
	 * happens when they try to get in.
	 *
	 * Fully synchronous, and the page above passes resolved props — a top-level
	 * await here would mark every `fields.X` expression below "blocked" and
	 * compile it into an async derived.
	 */
	let {
		groupId,
		joinPolicy,
		joinInstructions,
		visibility
	}: {
		groupId: string;
		joinPolicy: string;
		joinInstructions: string | null;
		visibility: string;
	} = $props();

	const fields = updateStaffGroup.fields;

	const policyOptions = [
		{ value: 'invite_only', label: 'Invite only — someone adds you' },
		{ value: 'open', label: 'Open — any member joins themselves' },
		{ value: 'by_application', label: 'By application — you ask, a leader approves' }
	];

	const visibilityOptions = [
		{ value: 'public', label: 'Public — anyone can find it' },
		{ value: 'members', label: 'Members — signed-in members only' },
		{ value: 'hidden', label: 'Hidden — not listed anywhere' }
	];
</script>

<InfoCard title="Enrollment">
	<Form remote={updateStaffGroup} guard successToast="Saved" onsuccess={() => invalidateAll()}>
		<input {...fields.groupId.as('hidden', groupId)} />

		<div class="space-y-4">
			<FormField
				field={fields.joinPolicy}
				type="select"
				label="How people join"
				value={joinPolicy}
				options={policyOptions}
				description="Invitations work the same way under all three — this decides what someone can do unaided."
			/>

			<FormField
				field={fields.joinInstructions}
				type="textarea"
				label="Joining instructions"
				value={joinInstructions ?? ''}
				description="Shown beside the Join button, or over the application box. “Third Thursday, bring a horn, charts provided.”"
			/>

			<FormField
				field={fields.visibility}
				type="select"
				label="Visibility"
				value={visibility}
				options={visibilityOptions}
			/>

			<div class="flex justify-end">
				<SubmitButton label="Save" />
			</div>
		</div>
	</Form>
</InfoCard>
