<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { grantableBy, grantRuleFor } from '$lib/config';
	import { setVolunteerRoleGrants } from '$lib/remote/volunteer.remote';

	/** What a confirmed signup in this role may do for its shift's event. */
	let { role, held }: { role: { id: string; name: string }; held: string[] } = $props();

	function span(cap: string): string {
		const days = grantRuleFor(cap)?.role?.graceDays ?? 0;
		return days === 0
			? "For the shift's event, while the shift runs."
			: `For the shift's event, from the shift's start until ${days} ${days === 1 ? 'day' : 'days'} after it ends.`;
	}

	const options = grantableBy('role').map((cap) => ({
		value: cap,
		label: grantRuleFor(cap)?.label ?? cap,
		description: span(cap)
	}));
</script>

<InfoCard title={m.staff_volunteer_roles_id_role_grants_card_title()}>
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Action
				action={setVolunteerRoleGrants}
				label={m.staff_edit()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_volunteer_roles_id_role_grants_card_modal_title({ name: role.name })}
				successToast={m.staff_volunteer_roles_id_role_grants_card_success_toast()}
			>
				{#snippet form()}
					<input {...setVolunteerRoleGrants.fields.roleId.as('hidden', role.id)} />
					<p class="text-muted">
						{m.staff_volunteer_roles_id_role_grants_card_volunteer_confirme()}
					</p>
					<CheckboxGroup
						field={setVolunteerRoleGrants.fields.capabilities}
						selected={held}
						{options}
					/>
				{/snippet}
			</Action>
		</div>
	{/snippet}

	{#if held.length === 0}
		<p class="text-muted">{m.staff_volunteer_roles_id_role_grants_card_role_grants_nothin()}</p>
	{:else}
		<ul class="space-y-2 text-sm">
			{#each held as cap (cap)}
				<li>
					<span class="font-medium">{grantRuleFor(cap)?.label ?? cap}</span>
					<span class="opacity-60">· {span(cap)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
