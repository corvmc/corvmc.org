<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { grantableBy, grantRuleFor, ROLE_GRANT_LEAD_DAYS_MAX } from '#lib/config.js';
	import { setVolunteerRoleGrants } from '#lib/remote/volunteer.remote.js';

	/** What a confirmed signup in this role may do for its shift's event, and from when. */
	let {
		role,
		held
	}: { role: { id: string; name: string; grantLeadDays: number }; held: string[] } = $props();

	const plural = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

	function span(cap: string, lead: number): string {
		const days = grantRuleFor(cap)?.role?.graceDays ?? 0;
		const from = lead > 0 ? `${plural(lead)} before the event` : "the shift's start";
		if (days === 0 && lead === 0) return "For the shift's event, while the shift runs.";
		const until = days === 0 ? 'the shift ends' : `${plural(days)} after the shift ends`;
		return `For the shift's event, from ${from} until ${until}.`;
	}

	// The checkbox descriptions show the stored lead time; a new one shows once saved.
	const options = $derived(
		grantableBy('role').map((cap) => ({
			value: cap,
			label: grantRuleFor(cap)?.label ?? cap,
			description: span(cap, role.grantLeadDays)
		}))
	);
</script>

<InfoCard title={m.staff_volunteer_roles_id_role_grants_card_title()}>
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Action
				action={setVolunteerRoleGrants}
				label={m.staff_edit_label()}
				variant="ghost"
				size="sm"
				modalTitle={m.staff_volunteer_roles_id_role_grants_card_modal_title({ name: role.name })}
				successToast={m.staff_volunteer_roles_id_role_grants_card_success_toast()}
			>
				{#snippet form()}
					<input {...setVolunteerRoleGrants.fields.roleId.as('hidden', role.id)} />
					<p class="text-muted">
						{m.staff_volunteer_roles_id_role_grants_card_volunteer_confirme_text()}
					</p>
					<CheckboxGroup
						field={setVolunteerRoleGrants.fields.capabilities}
						selected={held}
						{options}
					/>
					<FormField
						field={setVolunteerRoleGrants.fields.grantLeadDays}
						type="number"
						min={0}
						max={ROLE_GRANT_LEAD_DAYS_MAX}
						label={m.staff_volunteer_roles_id_role_grants_card_lead_days_label()}
						description={m.staff_volunteer_roles_id_role_grants_card_lead_days_body()}
						value={role.grantLeadDays}
					/>
				{/snippet}
			</Action>
		</div>
	{/snippet}

	{#if held.length === 0}
		<p class="text-muted">
			{m.staff_volunteer_roles_id_role_grants_card_role_grants_nothin_text()}
		</p>
	{:else}
		<ul class="space-y-2 text-sm">
			{#each held as cap (cap)}
				<li>
					<span class="font-medium">{grantRuleFor(cap)?.label ?? cap}</span>
					<span class="opacity-60">· {span(cap, role.grantLeadDays)}</span>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
