<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { grantableBy, grantRuleFor } from '$lib/config';
	import { setVolunteerRoleGrants } from '$lib/remote/volunteer.remote';

	/** What a confirmed signup in this role may do for its shift's event. */
	let { role }: { role: { id: string; name: string; capabilityGrants: string[] | null } } =
		$props();

	const held = $derived(role.capabilityGrants ?? []);

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

<InfoCard title="Grants">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Action
				action={setVolunteerRoleGrants}
				label="Edit"
				variant="ghost"
				size="sm"
				modalTitle="What {role.name} may do"
				successToast="Grants saved"
			>
				{#snippet form()}
					<input type="hidden" name="roleId" value={role.id} />
					<p class="text-muted">
						A volunteer confirmed on a shift in this role can do these for that shift's event and no
						other. You can only grant what your own position allows.
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
		<p class="text-muted">This role grants nothing beyond claiming its shifts.</p>
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
