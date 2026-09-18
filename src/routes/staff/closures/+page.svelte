<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDateTimeShort } from '$lib/utils/format';
	import Table from '$lib/components/ui/Table.svelte';
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

	<!--
		A table: two facts per row and two conditional actions, which is none of
		the four tests a card has to pass (#1034). Upcoming and past are separate
		sections because the page already knew which side of now each row was on
		and never said so.
	-->
	{#if closures.upcoming.length === 0 && closures.past.length === 0}
		<EmptyState message="No closures." />
	{:else}
		{#each [{ key: 'upcoming', title: 'Upcoming', rows: closures.upcoming }, { key: 'past', title: 'Past', rows: closures.past }] as section (section.key)}
			{#if section.rows.length > 0}
				<InfoCard
					title={section.title}
					state={section.key === 'past' && closures.morePast
						? `last ${section.rows.length}`
						: section.rows.length}
				>
					<Table>
						{#snippet head()}
							<th class="cell-primary">Reason</th>
							<th class="col-support whitespace-nowrap">From</th>
							<th class="col-support whitespace-nowrap">Until</th>
							<th class="w-px"><span class="sr-only">Actions</span></th>
						{/snippet}

						{#each section.rows as c (c.id)}
							{#if editId === c.id}
								<tr>
									<td colspan="4">
										<div class="space-y-3">
											<input type="text" bind:value={editReason} class="input w-full input-sm" />
											<div class="grid grid-cols-2 gap-4">
												<input
													type="datetime-local"
													bind:value={editStartsAt}
													class="input input-sm"
												/>
												<input
													type="datetime-local"
													bind:value={editEndsAt}
													class="input input-sm"
												/>
											</div>
											<div class="ml-auto flex w-max gap-2">
												<Button variant="ghost" size="sm" onclick={() => (editId = null)}>
													Cancel
												</Button>
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
									</td>
								</tr>
							{:else}
								<tr class="hover">
									<td class="cell-primary truncate font-medium">{c.reason}</td>
									<td class="col-support whitespace-nowrap">{formatDateTimeShort(c.startsAt)}</td>
									<td class="col-support whitespace-nowrap">{formatDateTimeShort(c.endsAt)}</td>
									<td class="w-px">
										{#if isFuture(c.startsAt)}
											<div class="flex w-max gap-1">
												<Button variant="ghost" size="xs" onclick={() => startEdit(c)}>Edit</Button>
												<DeleteClosureAction closureId={c.id} />
											</div>
										{/if}
									</td>
								</tr>
							{/if}
						{/each}
					</Table>
				</InfoCard>
			{/if}
		{/each}
	{/if}
</PageContent>
