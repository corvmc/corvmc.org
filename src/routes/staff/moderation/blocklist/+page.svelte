<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import { blocklistSourceLabels } from '#lib/config.js';
	import { Latest } from '#lib/latest.svelte.js';
	import {
		getBlocklist,
		addToBlocklist,
		removeFromBlocklist
	} from '#lib/remote/blocklist.remote.js';
	import StaffViews from '../../StaffViews.svelte';
	import { moderationViews } from '../views';

	const { fields: addFields } = addToBlocklist;

	const list = new Latest(() => getBlocklist());
	$effect(() => {
		if (list.error) throw list.error.e;
	});
</script>

<PageHeader title={m.staff_moderation_title()} documentTitle={m.staff_blocklist_title()}>
	<StaffViews views={moderationViews} active="blocklist" />
</PageHeader>
<PageContent>
	<InfoCard title={m.staff_blocklist_title()}>
		{#snippet header(title)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle level={2}>{title}</CardTitle>
				<Action
					action={addToBlocklist}
					label={m.staff_blocklist_add_label()}
					modalTitle={m.staff_blocklist_add_label()}
					submitLabel={m.staff_blocklist_add_label()}
					successToast={m.staff_blocklist_blocked_toast()}
					size="sm"
				>
					{#snippet form()}
						<FormField
							field={addFields.email}
							type="email"
							label={m.staff_email_label()}
							required
						/>
						<FormField
							field={addFields.note}
							type="textarea"
							label={m.staff_note_label()}
							description={m.staff_blocklist_note_body()}
						/>
					{/snippet}
				</Action>
			</div>
		{/snippet}
		{#if list.current}
			{#if list.current.length === 0}
				<EmptyState
					title={m.staff_blocklist_empty_title()}
					description={m.staff_blocklist_empty_body()}
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th class="cell-primary">{m.staff_email_label()}</th>
						<th class="col-support">{m.staff_source_label()}</th>
						<th class="col-support">{m.staff_blocklist_refused_label()}</th>
						<th class="col-extra">{m.staff_added_label()}</th>
						<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
					{/snippet}
					{#each list.current as row (row.id)}
						<tr>
							<td class="cell-primary">
								<div class="font-medium break-all">{row.email}</div>
								{#if row.note}
									<div class="text-muted whitespace-pre-line">{row.note}</div>
								{/if}
							</td>
							<td class="col-support">{blocklistSourceLabels[row.source]}</td>
							<td class="col-support">
								{row.refusedCount}
								{#if row.lastRefusedAt}
									<span class="text-muted"
										>{m.staff_blocklist_last_refused_text({
											date: formatDateShortYear(row.lastRefusedAt)
										})}</span
									>
								{/if}
							</td>
							<td class="col-extra whitespace-nowrap">
								{formatDateShortYear(row.createdAt)}
								{#if row.addedByName}<span class="text-muted">· {row.addedByName}</span>{/if}
							</td>
							<td>
								<Action
									action={removeFromBlocklist.for(row.id)}
									label={m.staff_blocklist_unblock_label()}
									submitLabel={m.staff_blocklist_unblock_label()}
									successToast={m.staff_blocklist_unblocked_toast()}
									variant="ghost"
									size="sm"
								>
									{#snippet form()}
										{@const fields = removeFromBlocklist.for(row.id).fields}
										<input {...fields.id.as('hidden', row.id)} />
										<p class="py-4">{m.staff_blocklist_unblock_text({ email: row.email })}</p>
									{/snippet}
								</Action>
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		{/if}
	</InfoCard>
</PageContent>
