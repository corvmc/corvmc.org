<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Why a person can act (#2994): each position, committee seat and live shift
	 * role, with what it lets them do. The lists come from the functions the
	 * guards ask, so this shows nothing a guard refuses.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { positionLabels } from '#lib/config.js';
	import { capabilityLabel } from '#lib/capability-label.js';
	import type { getPersonAccessWhy } from '#lib/remote/why-can-act.remote.js';

	let { why }: { why: Awaited<ReturnType<typeof getPersonAccessWhy>> } = $props();

	const empty = $derived(
		why.positions.length === 0 && why.departments.length === 0 && why.shiftRoles.length === 0
	);
</script>

{#if empty}
	<EmptyState title={m.access_why_none_title()} description={m.access_why_none_body()} />
{/if}

{#if why.positions.length > 0}
	<InfoCard title={m.access_why_positions_title()} state={why.positions.length}>
		<ul class="flex flex-col gap-3" data-testid="why-positions">
			{#each why.positions as p (p.position)}
				<li>
					<div class="font-medium">{positionLabels[p.position]}</div>
					<ul class="text-muted text-sm">
						{#each p.capabilities as cap (cap)}
							<li>{capabilityLabel(cap)}</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

{#if why.departments.length > 0}
	<InfoCard title={m.access_why_committees_title()} state={why.departments.length}>
		<ul class="flex flex-col gap-3" data-testid="why-committees">
			{#each why.departments as d (d.groupId)}
				<li>
					<div class="font-medium">{d.name}</div>
					<div class="text-sm">
						{d.positions.length > 0 ? d.positions.join(', ') : m.access_why_member_text()}
					</div>
					<ul class="text-muted text-sm">
						<li>{m.access_why_tasks_text()}</li>
						{#each d.grants as g (g.capability)}
							<li>
								{g.reach === 'owned'
									? m.access_why_owned_text({ label: capabilityLabel(g.capability) })
									: capabilityLabel(g.capability)}
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

{#if why.shiftRoles.length > 0}
	<InfoCard title={m.access_why_shift_roles_title()} state={why.shiftRoles.length}>
		<ul class="flex flex-col gap-3" data-testid="why-shift-roles">
			{#each why.shiftRoles as r (`${r.roleName}:${r.eventId}`)}
				<li>
					<div class="font-medium">{r.roleName}</div>
					<div class="text-sm">{r.eventTitle}</div>
					<ul class="text-muted text-sm">
						{#each r.capabilities as cap (cap)}
							<li>{capabilityLabel(cap)}</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}
