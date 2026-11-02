<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		getAccessRegister,
		getPoolCodes,
		getUnmanagedLockUsers,
		grantCodeForm,
		issueAccessForm,
		returnAccessForm,
		revokeCodeForm
	} from '$lib/remote/lock.remote';
	import { accessHoldingKindLabels, accessHoldingKinds, clubToday } from '$lib/config';
	import { formatDateShort } from '$lib/utils/format';
	import { errorMessage } from '$lib/error-message';
	import { retryQuery } from '$lib/utils/retry-query';
	import { toast } from 'svelte-sonner';
	import PoolCodes from './PoolCodes.svelte';
	import UnmanagedLockCodes from './UnmanagedLockCodes.svelte';

	/**
	 * Who can open this door. Keys and alarm codes are recorded here; standing
	 * door codes live on the lock and are granted and revoked here, so a
	 * returned key and a revoked code read the same way. Booking codes and the
	 * lock's unaccounted-for users each load behind their own tab.
	 */
	type View = 'held' | 'history' | 'booking' | 'unmanaged';
	let view = $state<View>('held');
	let holderUserId = $state('');
	let holderPicked = $state('');
	let grantUserId = $state('');
	let grantPicked = $state('');
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
		action={grantCodeForm}
		label="Grant a door code"
		modalTitle="Grant a door code"
		submitLabel="Grant"
		variant="ghost"
		canSubmit={grantUserId !== ''}
		onsuccess={(result) => {
			toast.success(`Door code ${(result as { code: string }).code} sent to the lock`);
			grantUserId = '';
			grantPicked = '';
		}}
	>
		{#snippet form()}
			<MemberPicker
				field={grantCodeForm.fields.holderUserId}
				label="Member"
				bind:value={grantUserId}
				bind:name={grantPicked}
			/>
		{/snippet}
	</Action>
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
			{ key: 'history', label: 'History' },
			{ key: 'booking', label: 'Booking codes' },
			{ key: 'unmanaged', label: 'Unmanaged' }
		]}
		active={view}
		onchange={(key) => (view = key as View)}
	/>

	{#if view === 'booking'}
		<svelte:boundary>
			<PoolCodes />
			{#snippet failed(error, reset)}
				<Alert type="warning" reset={() => retryQuery(getPoolCodes(), reset)}>
					{errorMessage(error)}
				</Alert>
			{/snippet}
		</svelte:boundary>
	{:else if view === 'unmanaged'}
		<svelte:boundary>
			<UnmanagedLockCodes />
			{#snippet failed(error, reset)}
				<Alert type="warning" reset={() => retryQuery(getUnmanagedLockUsers(), reset)}>
					Could not read the lock's own door codes: {errorMessage(error)}
				</Alert>
			{/snippet}
		</svelte:boundary>
	{:else if rows.length === 0}
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
						{#if row.code}<span class="font-mono">{row.code}</span>{/if}
					</td>
					<td>
						{formatDateShort(row.issuedAt)}
						{#if row.issuedByName}<div class="text-subtle">by {row.issuedByName}</div>{/if}
					</td>
					<td class="w-px text-right">
						{#if row.returnedAt}
							{formatDateShort(row.returnedAt)}
							{#if row.returnNotes}<div class="text-subtle">{row.returnNotes}</div>{/if}
						{:else if row.source === 'lock'}
							{@const revoke = revokeCodeForm.for(row.id)}
							<Action
								action={revoke}
								variant="ghost"
								size="sm"
								label="Revoke"
								modalTitle="Revoke door code"
								submitLabel="Revoke"
								submitVariant="error"
								successToast="Revoked"
							>
								{#snippet form()}
									<input {...revoke.fields.id.as('hidden', row.id)} />
									<p>{row.holderName}'s code comes off the lock.</p>
									<Field field={revoke.fields.reason} type="text" label="Why" />
								{/snippet}
							</Action>
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
