<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import type { GroupKind } from '$lib/config';
	import { resolve } from '$app/paths';
	import { retryQuery } from '$lib/utils/retry-query';
	import { getStaffBandPage } from '$lib/remote/bands.remote';
	import { getStaffGroupPage, getStaffCommitteePage } from '$lib/remote/groups.remote';
	import GroupRecord from './GroupRecord.svelte';

	/** A group's record beside a Groups view, with a link on to its own page. */
	let {
		kind,
		id,
		name,
		open = $bindable(false)
	}: { kind: GroupKind; id: string; name: string; open?: boolean } = $props();

	const recordQuery = () =>
		kind === 'band'
			? getStaffBandPage(id)
			: kind === 'club'
				? getStaffGroupPage(id)
				: getStaffCommitteePage(id);
</script>

<Modal bind:open title={name} placement="end" maxWidth="max-w-5xl">
	<svelte:boundary>
		<GroupRecord {kind} {id} variant="panel">
			{#snippet actions()}
				<Button href={resolve(`/staff/groups/${id}`)} variant="ghost" size="sm">Open record</Button>
			{/snippet}
		</GroupRecord>

		{#snippet pending()}
			<span class="loading loading-spinner"></span>
		{/snippet}
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(recordQuery(), reset)}
				>The record didn't load.</Alert
			>
		{/snippet}
	</svelte:boundary>
</Modal>
