<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { IconTrash } from '@tabler/icons-svelte';
	import { addActGuest, removeActGuest } from '#lib/remote/events.remote.js';

	/**
	 * One act's guest list (#3274): free tickets tied to the credit, each emailed
	 * its ticket. The count is the first thing the row shows; the names sit under it.
	 */
	let {
		eventBandId,
		actName,
		guests
	}: {
		eventBandId: string;
		actName: string;
		guests: { id: string; name: string; email: string; status: string }[];
	} = $props();

	const add = $derived(addActGuest.for(eventBandId));
</script>

<div class="flex flex-col gap-1 pl-16 text-sm" data-testid="act-guests">
	<div class="flex items-center gap-2">
		<span class="text-muted">{m.staff_events_id_production_guests_text()}</span>
		<Badge variant="outline">{guests.length}</Badge>
		<Action
			action={add}
			label={m.staff_events_id_production_guests_add_label()}
			variant="ghost"
			size="xs"
			modalTitle={m.staff_events_id_production_guests_add_title()}
			submitLabel={m.staff_events_id_production_guests_add_label()}
			successToast={m.staff_events_id_production_guests_add_toast()}
		>
			{#snippet form()}
				<input {...add.fields.eventBandId.as('hidden', eventBandId)} />
				<p class="mb-3 text-sm">
					{m.staff_events_id_production_guests_add_text({ name: actName })}
				</p>
				<div class="space-y-3">
					<FormField
						field={add.fields.attendeeName}
						label={m.staff_events_id_production_guests_name_label()}
						required
					/>
					<FormField
						field={add.fields.attendeeEmail}
						type="email"
						label={m.staff_events_id_production_guests_email_label()}
						required
					/>
				</div>
			{/snippet}
		</Action>
	</div>

	{#if guests.length > 0}
		<ul class="divide-y divide-base-200" data-testid="act-guest-rows">
			{#each guests as guest (guest.id)}
				{@const drop = removeActGuest.for(guest.id)}
				<li class="flex items-center gap-2 py-1" data-testid="act-guest-row">
					<span class="min-w-0 grow truncate">
						{guest.name}
						<span class="text-subtle">{guest.email}</span>
					</span>
					{#if guest.status === 'checked_in'}
						<Badge variant="outline">{m.staff_events_id_production_guests_in_label()}</Badge>
					{:else}
						<Action
							action={drop}
							label={m.staff_events_id_production_guests_remove_label()}
							iconOnly
							icon={trashIcon}
							variant="ghost"
							size="xs"
							class="text-error"
							modalTitle={m.staff_events_id_production_guests_remove_title()}
							submitLabel={m.staff_events_id_production_guests_remove_label()}
							submitVariant="error"
							successToast={m.staff_events_id_production_guests_remove_toast()}
						>
							{#snippet form()}
								<input {...drop.fields.ticketId.as('hidden', guest.id)} />
								<p class="text-sm">
									{m.staff_events_id_production_guests_remove_text({ name: guest.name })}
								</p>
							{/snippet}
						</Action>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
