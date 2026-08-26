<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { invalidateAll } from '$app/navigation';
	import { formatDateTime } from '$lib/utils/format';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { Field } from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { UpdateClosureAction, DeleteClosureAction } from '$lib/components/actions';
	import Button from '$lib/components/ui/Button.svelte';
	import { getClosures, createClosure } from '$lib/remote/closures.remote';

	let closures = $derived(await getClosures());

	let editId = $state<string | null>(null);
	let editReason = $state('');
	let editStartsAt = $state('');
	let editEndsAt = $state('');

	function isFuture(d: Date): boolean {
		return d > new Date();
	}

	function toLocalDatetime(d: Date): string {
		const offset = d.getTimezoneOffset();
		const local = new Date(d.getTime() - offset * 60000);
		return local.toISOString().slice(0, 16);
	}

	function startEdit(c: { id: string; reason: string; startsAt: Date; endsAt: Date }) {
		editId = c.id;
		editReason = c.reason;
		editStartsAt = toLocalDatetime(c.startsAt);
		editEndsAt = toLocalDatetime(c.endsAt);
	}
</script>

<PageHeader title="Closures" />
<PageContent>
	<InfoCard title="Add Closure">
		<Form remote={createClosure} successToast="Closure added" onsuccess={() => invalidateAll()}>
			<div class="space-y-3">
				<Field name="reason" type="text" label="Reason" />
				<div class="grid grid-cols-2 gap-4">
					<Field name="startsAt" type="datetime-local" label="Start" />
					<Field name="endsAt" type="datetime-local" label="End" />
				</div>
				<SubmitButton label="Add Closure" variant="primary" />
			</div>
		</Form>
	</InfoCard>

	{#if closures.length === 0}
		<EmptyState message="No closures." />
	{:else}
		<div class="space-y-3">
			{#each closures as c (c.id)}
				<Card>
					<CardBody class="py-4">
						{#if editId === c.id}
							<div class="space-y-3">
								<input type="text" bind:value={editReason} class="input w-full input-sm" />
								<div class="grid grid-cols-2 gap-4">
									<input type="datetime-local" bind:value={editStartsAt} class="input input-sm" />
									<input type="datetime-local" bind:value={editEndsAt} class="input input-sm" />
								</div>
								<div class="flex justify-end gap-2">
									<Button variant="ghost" size="sm" onclick={() => (editId = null)}>Cancel</Button>
									<UpdateClosureAction
										closureId={c.id}
										reason={editReason}
										startsAt={editStartsAt}
										endsAt={editEndsAt}
										onsuccess={() => {
											editId = null;
											invalidateAll();
										}}
									/>
								</div>
							</div>
						{:else}
							<div class="flex items-center justify-between">
								<div>
									<p class="font-medium">{c.reason}</p>
									<p class="text-muted">
										{formatDateTime(c.startsAt)} — {formatDateTime(c.endsAt)}
									</p>
								</div>
								{#if isFuture(c.startsAt)}
									<div class="flex gap-1">
										<Button variant="ghost" size="sm" onclick={() => startEdit(c)}>Edit</Button>
										<DeleteClosureAction closureId={c.id} />
									</div>
								{/if}
							</div>
						{/if}
					</CardBody>
				</Card>
			{/each}
		</div>
	{/if}
</PageContent>
