<script lang="ts">
	/**
	 * Start a ballot as a draft. Nothing is frozen until someone presses Open.
	 *
	 * A committee ballot's certifier is picked from the rosters the caller can
	 * see; a member-wide one's from the whole membership, over the staff search.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { IconPlus } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { createBallot } from '$lib/remote/ballots.remote';

	type Committee = { id: string; name: string; members: { id: string; name: string }[] };

	let {
		kind,
		panel,
		committees = []
	}: { kind: 'member' | 'group'; panel: 'member' | 'staff'; committees?: Committee[] } = $props();

	const action = $derived(createBallot.for(kind));

	let certifierId = $state('');
	let certifierName = $state('');

	const people = $derived(
		[...new Map(committees.flatMap((c) => c.members).map((m) => [m.id, m] as const)).values()].map(
			(m) => ({ value: m.id, label: m.name })
		)
	);
</script>

<Action
	{action}
	label={kind === 'member' ? 'New member-wide ballot' : 'New committee ballot'}
	modalTitle={kind === 'member' ? 'New member-wide ballot' : 'New committee ballot'}
	submitLabel="Save draft"
	successToast="Draft saved. Open it when it is ready."
	size="sm"
	onsuccess={(r) => {
		if (r && typeof r === 'object' && 'id' in r) {
			const id = r.id as string;
			void goto(
				panel === 'staff' ? resolve(`/staff/ballots/${id}`) : resolve(`/member/ballots/${id}`)
			);
		}
	}}
>
	{#snippet icon()}<IconPlus size={16} />{/snippet}
	{#snippet form()}
		<input {...action.fields.kind.as('hidden', kind)} />
		{#if kind === 'group'}
			<FormField
				field={action.fields.groupId}
				type="select"
				label="Committee"
				options={committees.map((c) => ({ value: c.id, label: c.name }))}
			/>
		{/if}
		<FormField field={action.fields.title} type="text" label="Question" />
		<FormField field={action.fields.description} type="textarea" label="Background (optional)" />
		<FormField
			field={action.fields.options}
			type="textarea"
			label="Choices"
			description="One per line, between 2 and 10."
		/>
		<FormField field={action.fields.closesOn} type="date" label="Voting closes at the end of" />
		{#if kind === 'group'}
			<FormField
				field={action.fields.certifierId}
				type="select"
				label="Certifier"
				description="Who confirms the result once voting closes."
				options={people}
			/>
		{:else}
			<MemberPicker
				field={action.fields.certifierId}
				label="Certifier"
				bind:value={certifierId}
				bind:name={certifierName}
			/>
		{/if}
	{/snippet}
</Action>
