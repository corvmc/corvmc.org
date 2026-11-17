<script lang="ts" generics="TInput extends RemoteFormInput, TOutput extends CheckInResult">
	/**
	 * One list row's check-in button, for staff, the door volunteer and a band
	 * (#3204). `TOutput` must carry `alreadyIn`, so a remote that drops it does
	 * not type-check here. A repeat warns and stays allowed: the door decides.
	 */
	import type { Snippet } from 'svelte';
	import type { RemoteForm, RemoteFormInput } from '$app/server';
	import { toast } from 'svelte-sonner';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import { checkInOutcome, type CheckInResult } from './check-in-outcome.js';

	let {
		remote,
		name,
		successToast,
		onsuccess,
		children,
		class: className
	}: {
		remote: Omit<RemoteForm<TInput, TOutput>, 'for'>;
		/** The attendee, as the warning names them. */
		name: string;
		successToast: string;
		onsuccess?: () => unknown;
		children: Snippet;
		class?: string;
	} = $props();

	async function done(result?: TOutput) {
		if (result?.alreadyIn) toast.warning(checkInOutcome(name, result).text);
		else toast.success(successToast);
		await onsuccess?.();
	}
</script>

<Form {remote} onsuccess={done} class={className}>
	{@render children()}
</Form>
