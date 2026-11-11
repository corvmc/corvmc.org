<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { getAccessRegister, issueAccessForm, returnAccessForm } from '#lib/remote/lock.remote.js';
	import { accessHoldingKindLabels, accessHoldingKinds, clubToday } from '#lib/config.js';
	import { formatDateShort } from '#lib/utils/format.js';
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

<PageHeader title={m.staff_keys_key_holders_title()} subtitle={m.staff_space_body()}>
	<TabBar
		tabs={[
			{ key: 'held', label: m.staff_keys_held_now_label() },
			{ key: 'history', label: m.staff_history_label() }
		]}
		active={view}
		onchange={(key) => (view = key as 'held' | 'history')}
	/>
	<Action
		action={issueAccessForm}
		label={m.staff_keys_record_key_code_label()}
		modalTitle={m.staff_keys_record_key_code_title()}
		submitLabel={m.staff_record_label()}
		successToast={m.staff_keys_recorded_toast()}
		onsuccess={() => {
			holderUserId = '';
			holderPicked = '';
		}}
	>
		{#snippet form()}
			<Field field={fields.kind} type="select" label={m.staff_what_label()} options={kindOptions} />
			<Field
				field={fields.label}
				type="text"
				label={m.staff_keys_which_one_label()}
				description={m.staff_keys_how_tell_apart_front_door_body()}
			/>
			<MemberPicker
				field={fields.holderUserId}
				label={m.staff_keys_held_by_label()}
				bind:value={holderUserId}
				bind:name={holderPicked}
			/>
			<Field
				field={fields.holderName}
				type="text"
				label={m.staff_keys_name_label()}
				description={m.staff_keys_somebody_without_account_landlord_contractor_body()}
			/>
			<Field
				field={fields.issuedOn}
				type="date"
				label={m.staff_keys_issued_label()}
				value={clubToday()}
			/>
			<Field field={fields.notes} type="textarea" label={m.staff_notes_label()} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if rows.length === 0}
		<EmptyState
			title={view === 'held'
				? m.staff_keys_nobody_register_title()
				: m.staff_keys_nothing_recorded_yet_title()}
			description={m.staff_keys_record_each_physical_key_alarm_body()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_keys_held_by_label()}</th>
				<th>{m.staff_what_label()}</th>
				<th>{m.staff_keys_issued_2_label()}</th>
				<th>{view === 'history' ? m.staff_returned_label() : ''}</th>
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
								{m.staff_keys_by_text({ issuedByName: row.issuedByName })}
							</div>{/if}
					</td>
					<td class="text-right">
						{#if row.returnedAt}
							{formatDateShort(row.returnedAt)}
							{#if row.returnNotes}<div class="text-subtle">{row.returnNotes}</div>{/if}
						{:else if row.source === 'lock'}
							<Button href={resolve('staff/settings')} variant="ghost" size="sm">
								{m.staff_keys_door_access_label()}
							</Button>
						{:else}
							{@const ret = returnAccessForm.for(row.id)}
							<Action
								action={ret}
								variant="ghost"
								size="sm"
								label={m.staff_returned_label()}
								modalTitle={m.staff_keys_mark_returned_title()}
								submitLabel={m.staff_keys_mark_returned_label()}
								successToast={m.staff_keys_marked_returned_toast()}
							>
								{#snippet form()}
									<input {...ret.fields.id.as('hidden', row.id)} />
									<p>
										{m.staff_keys_handed_back_text({
											holderName: row.holderName,
											label: row.label
										})}
									</p>
									<Field
										field={ret.fields.returnedOn}
										type="date"
										label={m.staff_keys_returned_label()}
										value={clubToday()}
									/>
									<Field field={ret.fields.notes} type="textarea" label={m.staff_notes_label()} />
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
