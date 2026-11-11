<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import type { GroupKind } from '#lib/config.js';
	import { resolve } from '$app/paths';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import { getStaffBandPage } from '#lib/remote/bands.remote.js';
	import { getStaffGroupPage, getStaffCommitteePage } from '#lib/remote/groups.remote.js';
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
				<Button href={resolve(`staff/groups/${id}`)} variant="ghost" size="sm"
					>{m.staff_groups_id_group_record_panel_open_record_label()}</Button
				>
			{/snippet}
		</GroupRecord>

		{#snippet pending()}
			<span class="loading loading-spinner"></span>
		{/snippet}
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(recordQuery(), reset)}
				>{m.staff_groups_id_group_record_panel_record_didn_t_load_body()}</Alert
			>
		{/snippet}
	</svelte:boundary>
</Modal>
