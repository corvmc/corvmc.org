<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { getAccessRegister, issueAccessForm, returnAccessForm } from '$lib/remote/lock.remote';
	import { accessHoldingKindLabels, accessHoldingKinds, clubToday } from '$lib/config';
	import { formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	/**
	 * Who can get into the building without a booking. Keys and alarm codes are
	 * recorded here; standing door codes are read from Door access and managed
	 * there, so a returned key and a revoked code read the same way.
	 */
	let view = $state<'held' | 'history'>('held');
	let holderUserId = $state('');
	let holderPicked = $state('');
	const { fields } = issueAccessForm;

	const kindLabels = { ...accessHoldingKindLabels, lock_code: 'Door code' } as const;
	const kindOptions = accessHoldingKinds.map((k) => ({
		value: k,
		label: accessHoldingKindLabels[k]
	}));

	const rows = $derived(await getAccessRegister(view === 'history'));
</script>

<PageHeader title="Key Holders" subtitle="Space">
	<Action
		action={issueAccessForm}
		label="Record a key or code"
		modalTitle="Record a key or code"
		submitLabel="Record"
		successToast="Recorded"
		onsuccess={() => {
			holderUserId = '';
			holderPicked = '';
		}}
	>
		{#snippet form()}
			<Field field={fields.kind} type="select" label="What" options={kindOptions} />
			<Field
				field={fields.label}
				type="text"
				label="Which one"
				description="How you tell it apart — “Front door key 3”, “Alarm user 12”. Never the code itself."
			/>
			<MemberPicker
				field={fields.holderUserId}
				label="Held by"
				bind:value={holderUserId}
				bind:name={holderPicked}
			/>
			<Field
				field={fields.holderName}
				type="text"
				label="Or a name"
				description="For somebody without an account — the landlord, a contractor."
			/>
			<Field field={fields.issuedOn} type="date" label="Issued on" value={clubToday()} />
			<Field field={fields.notes} type="textarea" label="Notes" />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	<TabBar
		tabs={[
			{ key: 'held', label: 'Held now' },
			{ key: 'history', label: 'History' }
		]}
		active={view}
		onchange={(key) => (view = key as 'held' | 'history')}
	/>

	{#if rows.length === 0}
		<EmptyState
			title={view === 'held' ? 'Nobody is on the register' : 'Nothing recorded yet'}
			description="Record each physical key and alarm code when it is handed over, and mark it returned when it comes back."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Held by</th>
				<th>What</th>
				<th>Issued</th>
				<th>{view === 'history' ? 'Returned' : ''}</th>
			{/snippet}
			{#each rows as row (row.source + row.id)}
				<tr>
					<td class="cell-primary">
						<span class="font-medium">{row.holderName}</span>
						{#if row.notes}<div class="text-subtle">{row.notes}</div>{/if}
					</td>
					<td>
						<Badge variant="outline" size="sm">{kindLabels[row.kind]}</Badge>
						{row.label}
					</td>
					<td>
						{formatDateShort(row.issuedAt)}
						{#if row.issuedByName}<div class="text-subtle">by {row.issuedByName}</div>{/if}
					</td>
					<td class="text-right">
						{#if row.returnedAt}
							{formatDateShort(row.returnedAt)}
							{#if row.returnNotes}<div class="text-subtle">{row.returnNotes}</div>{/if}
						{:else if row.source === 'lock'}
							<Button href={resolve('/staff/settings')} variant="ghost" size="sm">
								Door access
							</Button>
						{:else}
							{@const ret = returnAccessForm.for(row.id)}
							<Action
								action={ret}
								variant="ghost"
								size="sm"
								label="Returned"
								modalTitle="Mark returned"
								submitLabel="Mark returned"
								successToast="Marked returned"
							>
								{#snippet form()}
									<input {...ret.fields.id.as('hidden', row.id)} />
									<p>{row.holderName} handed back {row.label}.</p>
									<Field field={ret.fields.notes} type="textarea" label="Notes" />
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
