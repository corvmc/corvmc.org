<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { grantInstructor } from '#lib/remote/instructors.remote.js';
	import { refreshAll } from '$app/navigation';

	/**
	 * Resume a paused teacher or reinstate a retired one. Both are `grant()`,
	 * which clears the staff note; only the word differs.
	 */
	let { userId, name, kind }: { userId: string; name: string; kind: 'resume' | 'reinstate' } =
		$props();

	const instance = $derived(grantInstructor.for(userId));
</script>

<Action
	action={instance}
	label={kind === 'resume'
		? m.staff_members_instructors_resume_label()
		: m.staff_members_instructors_reinstate_label()}
	modalTitle={kind === 'resume'
		? m.staff_members_instructors_resume_title({ name })
		: m.staff_members_instructors_reinstate_title({ name })}
	submitLabel={kind === 'resume'
		? m.staff_members_instructors_resume_label()
		: m.staff_members_instructors_reinstate_label()}
	successToast={kind === 'resume'
		? m.staff_members_instructors_resumed_toast()
		: m.staff_members_instructors_reinstated_toast()}
	variant="ghost"
	size="sm"
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...instance.fields.userId.as('hidden', userId)} />
			<p class="text-subtle">{m.staff_members_instructors_resume_text()}</p>
		</div>
	{/snippet}
</Action>
