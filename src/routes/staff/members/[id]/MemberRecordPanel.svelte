<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { getUserPage } from '$lib/remote/users.remote';
	import { retryQuery } from '$lib/utils/retry-query';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import type { TabKey } from './tabs';
	import MemberRecord from './MemberRecord.svelte';

	/**
	 * The member record beside a Members roster. Tab changes stay local: the URL
	 * is the roster's, and "Open record" carries the tab to the full page.
	 */
	let {
		id,
		name,
		tab: initialTab = 'overview',
		open = $bindable(false)
	}: { id: string; name: string; tab?: TabKey; open?: boolean } = $props();

	// svelte-ignore state_referenced_locally
	let tab = $state<TabKey>(initialTab);

	const href = $derived(
		withQuery(resolve(`/staff/members/${id}`), tab === 'overview' ? '' : `tab=${tab}`)
	);
</script>

<Modal bind:open title={name} placement="end" maxWidth="max-w-5xl">
	<svelte:boundary>
		<MemberRecord {id} bind:tab variant="panel">
			{#snippet actions()}
				<Button {href} variant="ghost" size="sm">Open record</Button>
			{/snippet}
		</MemberRecord>

		{#snippet pending()}
			<span class="loading loading-spinner"></span>
		{/snippet}
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getUserPage(id), reset)}>
				The record didn't load.
			</Alert>
		{/snippet}
	</svelte:boundary>
</Modal>
