<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import { CashReceivedAction, NoShowReservationAction } from '$lib/components/shared/actions';
	import { invalidateAll } from '$app/navigation';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import type { MemberRef } from '$lib/types/entity';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { formatCents, formatDate, formatTimeRange } from '$lib/utils/format';

	let {
		open = $bindable(false),
		unresolved,
		hourlyRateCents
	}: {
		open: boolean;
		unresolved: Array<{
			id: string;
			status: string;
			startsAt: Date;
			endsAt: Date;
			createdByUserId: string;
			notes: string | null;
			member: MemberRef;
			cashDueCents: number | null;
		}>;
		hourlyRateCents: number;
	} = $props();

	function dueLabel(r: { startsAt: Date; endsAt: Date; cashDueCents: number | null }): string {
		const hrs = (r.endsAt.getTime() - r.startsAt.getTime()) / (1000 * 60 * 60);
		const dueCents = r.cashDueCents ?? Math.round(hrs * hourlyRateCents);
		const hrsLabel = hrs === 1 ? '1 hr' : `${hrs} hrs`;
		return `${hrsLabel} · ${formatCents(dueCents)} due`;
	}

	let resolved = $state<Set<string>>(new Set());

	const visible = $derived(unresolved.filter((r) => !resolved.has(r.id)));

	function markResolved(id: string) {
		resolved = new Set([...resolved, id]);
		invalidateAll();
		if (visible.length <= 1) {
			setTimeout(() => {
				open = false;
				resolved = new Set();
			}, 1500);
		}
	}
</script>

<Modal bind:open>
	{#snippet titleSnippet()}
		<h3 class="text-lg font-bold">
			Resolve
			{#if visible.length > 0}
				<Badge variant="warning" class="ml-1">{visible.length}</Badge>
			{/if}
		</h3>
	{/snippet}

	{#if visible.length === 0}
		<div class="text-center py-8">
			<IconCheck size={48} class="mx-auto text-success mb-2" />
			<p class="text-lg font-medium">All caught up!</p>
		</div>
	{:else}
		<div class="space-y-3 max-h-96 overflow-y-auto">
			{#each visible as r (r.id)}
				<Card bordered>
					<CardBody padding="sm">
						<div class="flex justify-between mb-2">
							<EntityIdentity ref={r.member} size="md" />
							<div class="text-right">
								<p class="text-sm">{formatDate(r.startsAt)}</p>
								<p class="text-muted">{formatTimeRange(r.startsAt, r.endsAt)}</p>
								<p class="text-muted">{dueLabel(r)}</p>
							</div>
						</div>
						<div class="flex justify-end gap-2">
							<CashReceivedAction reservation={r} onsuccess={() => markResolved(r.id)} />
							<NoShowReservationAction
								reservation={r}
								variant="error"
								size="sm"
								outline
								onsuccess={() => markResolved(r.id)}
							/>
						</div>
					</CardBody>
				</Card>
			{/each}
		</div>
	{/if}
</Modal>
