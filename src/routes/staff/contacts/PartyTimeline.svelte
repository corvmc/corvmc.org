<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		addActivityForm,
		deleteActivityForm,
		getPartyTimeline,
		updateActivityForm
	} from '#lib/remote/contacts.remote.js';
	import { activityKindLabels, activityKinds, type ActivityKind } from '#lib/config.js';
	import { formatCents, toLocalDate } from '#lib/utils/format.js';
	import RecordGift from './RecordGift.svelte';

	/**
	 * One organization's or person's timeline (#2622): the notes staff logged,
	 * changes to its grants, sponsorships and jobs, and the tasks about it that
	 * were marked done, and its in-kind gifts. Notes are added, edited and
	 * deleted here, and gifts recorded.
	 */
	let {
		party,
		canManage,
		canRecordGift = false
	}: {
		party: { type: 'organization' | 'contact'; id: string };
		canManage: boolean;
		canRecordGift?: boolean;
	} = $props();

	type Item = NonNullable<Awaited<ReturnType<typeof getPartyTimeline>>>['items'][number];

	const kindOptions = activityKinds.map((k) => ({ value: k, label: activityKindLabels[k] }));

	function toRow(item: Item) {
		const row = { ...feedItemRow(item), item };
		if (item.source === 'note') {
			return { ...row, context: { label: activityKindLabels[item.note.kind as ActivityKind] } };
		}
		if (item.source === 'thread') {
			return {
				...row,
				href: resolve('/staff/inbox/[id]', { id: item.threadId }),
				context: { label: m.staff_contacts_conversation_label() }
			};
		}
		if (item.source === 'gift') {
			return {
				...row,
				summary: `${item.summary} — ${formatCents(item.amountCents)}`,
				context: { label: m.staff_contacts_gift_label() }
			};
		}
		if (item.source === 'task') {
			return {
				...row,
				href: resolve('/staff/tasks/[id]', { id: item.workOrderId }),
				context: { label: m.staff_contacts_task_done_label() }
			};
		}
		return row;
	}
</script>

<ActivityFeedCard
	title={m.staff_contacts_timeline_title()}
	query={(limit) => getPartyTimeline(limit ? { ...party, limit } : party)}
	{toRow}
	empty={{ title: m.staff_contacts_no_activity_title() }}
>
	{#snippet actions()}
		{#if canRecordGift}
			<RecordGift {party} />
		{/if}
		{#if canManage}
			<Action
				action={addActivityForm}
				label={m.staff_contacts_log_activity_label()}
				modalTitle={m.staff_contacts_log_activity_title()}
				successToast={m.staff_contacts_activity_logged_toast()}
				variant="ghost"
				size="sm"
				data-testid="log-activity"
			>
				{#snippet form()}
					<input {...addActivityForm.fields.partyType.as('hidden', party.type)} />
					<input {...addActivityForm.fields.partyId.as('hidden', party.id)} />
					<Field
						field={addActivityForm.fields.kind}
						type="select"
						label={m.staff_type_label()}
						options={kindOptions}
						value="call"
					/>
					<Field
						field={addActivityForm.fields.occurredOn}
						type="date"
						label={m.staff_date_label()}
						value={toLocalDate(new Date())}
					/>
					<Field
						field={addActivityForm.fields.body}
						type="textarea"
						label={m.staff_contacts_activity_details_label()}
					/>
				{/snippet}
			</Action>
		{/if}
	{/snippet}
	{#snippet trailing({ item })}
		{#if canManage && item.source === 'note'}
			{@const note = item.note}
			{@const edit = updateActivityForm.for(note.id)}
			{@const drop = deleteActivityForm.for(note.id)}
			<Action
				action={edit}
				label={m.staff_edit_label()}
				modalTitle={m.staff_contacts_edit_activity_title()}
				successToast={m.staff_saved_toast()}
				variant="ghost"
				size="xs"
			>
				{#snippet form()}
					<input {...edit.fields.id.as('hidden', note.id)} />
					<Field
						field={edit.fields.kind}
						type="select"
						label={m.staff_type_label()}
						options={kindOptions}
						value={note.kind}
					/>
					<Field
						field={edit.fields.occurredOn}
						type="date"
						label={m.staff_date_label()}
						value={note.occurredOn}
					/>
					<Field
						field={edit.fields.body}
						type="textarea"
						label={m.staff_contacts_activity_details_label()}
						value={note.body}
					/>
				{/snippet}
			</Action>
			<Action
				action={drop}
				label={m.staff_delete_label()}
				modalTitle={m.staff_contacts_delete_activity_title()}
				submitVariant="error"
				successToast={m.staff_deleted_toast()}
				variant="ghost"
				size="xs"
			>
				{#snippet form()}
					<input {...drop.fields.id.as('hidden', note.id)} />
					<p>{m.staff_contacts_delete_activity_body()}</p>
				{/snippet}
			</Action>
		{/if}
	{/snippet}
</ActivityFeedCard>
