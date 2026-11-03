<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

<PageHeader title={m.staff_keys_key_holders()} subtitle={m.staff_space()}>
	<Action
		action={issueAccessForm}
		label={m.staff_keys_record_key_code()}
		modalTitle={m.staff_keys_record_key_code()}
		submitLabel={m.staff_record()}
		successToast={m.staff_keys_recorded()}
		onsuccess={() => {
			holderUserId = '';
			holderPicked = '';
		}}
	>
		{#snippet form()}
			<Field field={fields.kind} type="select" label={m.staff_what()} options={kindOptions} />
			<Field
				field={fields.label}
				type="text"
				label={m.staff_keys_which_one()}
				description={m.staff_keys_how_tell_apart_front_door()}
			/>
			<MemberPicker
				field={fields.holderUserId}
				label={m.staff_keys_held_by()}
				bind:value={holderUserId}
				bind:name={holderPicked}
			/>
			<Field
				field={fields.holderName}
				type="text"
				label={m.staff_keys_name()}
				description={m.staff_keys_somebody_without_account_landlord_contractor()}
			/>
			<Field
				field={fields.issuedOn}
				type="date"
				label={m.staff_keys_issued()}
				value={clubToday()}
			/>
			<Field field={fields.notes} type="textarea" label={m.staff_notes()} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	<TabBar
		tabs={[
			{ key: 'held', label: m.staff_keys_held_now() },
			{ key: 'history', label: m.staff_history() }
		]}
		active={view}
		onchange={(key) => (view = key as 'held' | 'history')}
	/>

	{#if rows.length === 0}
		<EmptyState
			title={view === 'held' ? m.staff_keys_nobody_register() : m.staff_keys_nothing_recorded_yet()}
			description={m.staff_keys_record_each_physical_key_alarm()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_keys_held_by()}</th>
				<th>{m.staff_what()}</th>
				<th>{m.staff_keys_issued_2()}</th>
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
						{#if row.issuedByName}<div class="text-subtle">
								{m.staff_keys_by({ issuedByName: row.issuedByName })}
							</div>{/if}
					</td>
					<td class="text-right">
						{#if row.returnedAt}
							{formatDateShort(row.returnedAt)}
							{#if row.returnNotes}<div class="text-subtle">{row.returnNotes}</div>{/if}
						{:else if row.source === 'lock'}
							<Button href={resolve('/staff/settings')} variant="ghost" size="sm">
								{m.staff_keys_door_access()}
							</Button>
						{:else}
							{@const ret = returnAccessForm.for(row.id)}
							<Action
								action={ret}
								variant="ghost"
								size="sm"
								label={m.staff_returned()}
								modalTitle={m.staff_keys_mark_returned()}
								submitLabel={m.staff_keys_mark_returned()}
								successToast={m.staff_keys_marked_returned()}
							>
								{#snippet form()}
									<input {...ret.fields.id.as('hidden', row.id)} />
									<p>
										{m.staff_keys_handed_back({ holderName: row.holderName, label: row.label })}
									</p>
									<Field
										field={ret.fields.returnedOn}
										type="date"
										label={m.staff_keys_returned()}
										value={clubToday()}
									/>
									<Field field={ret.fields.notes} type="textarea" label={m.staff_notes()} />
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
