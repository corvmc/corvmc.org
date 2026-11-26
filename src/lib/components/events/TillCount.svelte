<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconTrash } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { countTill, getTillCounts, removeTillCount } from '#lib/remote/door.remote.js';
	import { formatCents, formatDateTimeShort } from '#lib/utils/format.js';

	/**
	 * Counting the till at a handoff (#3273), on both check-in screens.
	 *
	 * Whoever holds the till says what is in it, so a show collects one count per
	 * handoff. Nothing here refuses who counts: a till counted by one person
	 * only warns when staff settle. The form is `.for(eventId)` because the
	 * staff and the volunteer screen each mount this component.
	 */
	let { eventId }: { eventId: string } = $props();

	const till = $derived(await getTillCounts(eventId));
	const count = $derived(countTill.for(eventId));
</script>

{#if till}
	<InfoCard title={m.events_till_count_title()}>
		{#key till.handoffs.length}
			<Form
				remote={count}
				successToast={m.events_till_count_recorded_toast()}
				class="flex items-end gap-2"
			>
				<input {...count.fields.eventId.as('hidden', eventId)} />
				<MoneyField
					field={count.fields.cashCents}
					label={m.events_till_count_cash_label()}
					class="grow"
				/>
				<SubmitButton
					label={m.events_till_count_submit_label()}
					variant="primary"
					class="min-h-11"
				/>
			</Form>
		{/key}

		{#if till.handoffs.length === 0}
			<p class="mt-3 text-muted">{m.events_till_count_none_text()}</p>
		{:else}
			<ul class="mt-3 divide-y divide-base-300">
				{#each till.handoffs as handoff (handoff.id)}
					{@const drop = removeTillCount.for(handoff.id)}
					<li class="flex items-center justify-between gap-2 py-2">
						<div class="min-w-0">
							<p class="font-medium">{formatCents(handoff.cashCents)}</p>
							<p class="truncate text-muted text-sm">
								{m.events_till_count_counted_text({
									name: handoff.byName ?? m.events_till_count_unknown_text(),
									at: formatDateTimeShort(handoff.at)
								})}
							</p>
						</div>
						{#if handoff.own}
							<Action
								action={drop}
								label={m.events_till_count_remove_label()}
								iconOnly
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle={m.events_till_count_remove_title()}
								submitLabel={m.events_till_count_remove_label()}
								submitVariant="error"
								successToast={m.events_till_count_removed_toast()}
							>
								{#snippet icon()}
									<IconTrash size={16} />
								{/snippet}
								{#snippet form()}
									<input {...drop.fields.countId.as('hidden', handoff.id)} />
								{/snippet}
							</Action>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-right font-medium">
				{m.events_till_count_total_text({ total: formatCents(till.totalCents ?? 0) })}
			</p>
		{/if}
	</InfoCard>
{/if}
