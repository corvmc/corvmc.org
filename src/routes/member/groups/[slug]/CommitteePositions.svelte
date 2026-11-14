<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import type { MemberRef } from '#lib/types/entity.js';
	import {
		createCommitteePosition,
		updateCommitteePosition,
		deleteCommitteePosition
	} from '#lib/remote/group-positions.remote.js';

	/**
	 * A committee's defined positions and who holds each (#2988). Its chair names
	 * and fills them; everyone on the roster reads them.
	 */
	let {
		slug,
		positions,
		members,
		canManage,
		onchanged
	}: {
		slug: string;
		positions: {
			id: string;
			name: string;
			holders: { memberId: string; member: MemberRef }[];
		}[];
		/** Active roster rows, the only people a position can go to. */
		members: { id: string; member: MemberRef }[];
		canManage: boolean;
		onchanged: () => void;
	} = $props();

	const createFields = createCommitteePosition.fields;
	const memberOptions = $derived(members.map((r) => ({ value: r.id, label: r.member.title })));
</script>

<InfoCard title={msg.member_groups_slug_positions_title()}>
	{#snippet action()}
		{#if canManage}
			<Action
				action={createCommitteePosition}
				label={msg.member_groups_slug_add_position_label()}
				modalTitle={msg.member_groups_slug_add_position_title()}
				submitLabel={msg.member_groups_slug_add_position_label()}
				successToast={msg.member_groups_slug_position_added_toast()}
				variant="ghost"
				size="sm"
				onsuccess={onchanged}
			>
				{#snippet form()}
					<input {...createFields.slug.as('hidden', slug)} />
					<FormField
						field={createFields.name}
						type="text"
						label={msg.member_name_label()}
						description={msg.member_groups_slug_position_name_body()}
						maxlength="60"
						required
					/>
				{/snippet}
			</Action>
		{/if}
	{/snippet}
	{#if positions.length === 0}
		<EmptyState
			title={msg.member_groups_slug_no_positions_title()}
			description={canManage ? msg.member_groups_slug_no_positions_body() : undefined}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{msg.member_groups_slug_position_label()}</th>
				<th>{msg.member_groups_slug_held_by_label()}</th>
				{#if canManage}
					<th class="w-px"><span class="sr-only">{msg.member_actions_label()}</span></th>
				{/if}
			{/snippet}
			{#each positions as p (p.id)}
				{@const edit = updateCommitteePosition.for(p.id)}
				{@const remove = deleteCommitteePosition.for(p.id)}
				<tr>
					<td class="cell-primary">{p.name}</td>
					<td>
						{#if p.holders.length === 0}
							<span class="text-muted">{msg.member_groups_slug_vacant_text()}</span>
						{:else}
							<div class="flex flex-wrap gap-1">
								{#each p.holders as h (h.memberId)}
									<EntityChip ref={h.member} />
								{/each}
							</div>
						{/if}
					</td>
					{#if canManage}
						<td class="w-px">
							<div class="flex w-max justify-end gap-2">
								<Action
									action={edit}
									label={msg.member_edit_label()}
									aria-label={msg.member_groups_slug_edit_position_label({ name: p.name })}
									modalTitle={msg.member_groups_slug_edit_position_title({ name: p.name })}
									successToast={msg.member_groups_slug_position_saved_toast()}
									variant="ghost"
									size="xs"
									onsuccess={onchanged}
								>
									{#snippet form()}
										<div class="space-y-4">
											<input {...edit.fields.slug.as('hidden', slug)} />
											<input {...edit.fields.positionId.as('hidden', p.id)} />
											<FormField
												field={edit.fields.name}
												type="text"
												label={msg.member_name_label()}
												value={p.name}
												maxlength="60"
												required
											/>
											<CheckboxGroup
												field={edit.fields.memberIds}
												legend={msg.member_groups_slug_holders_title()}
												description={msg.member_groups_slug_holders_body()}
												selected={p.holders.map((h) => h.memberId)}
												options={memberOptions}
											/>
										</div>
									{/snippet}
								</Action>
								<Action
									action={remove}
									label={msg.member_groups_slug_remove_label()}
									aria-label={msg.member_groups_slug_remove_2_label({ title: p.name })}
									confirm={msg.member_groups_slug_remove_position_body({ name: p.name })}
									successToast={msg.member_groups_slug_position_removed_toast()}
									variant="ghost"
									size="xs"
									onsuccess={onchanged}
								>
									{#snippet form()}
										<input {...remove.fields.slug.as('hidden', slug)} />
										<input {...remove.fields.positionId.as('hidden', p.id)} />
									{/snippet}
								</Action>
							</div>
						</td>
					{/if}
				</tr>
			{/each}
		</Table>
	{/if}
</InfoCard>
