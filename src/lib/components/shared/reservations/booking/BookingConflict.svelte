<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { getFormContext } from '$lib/components/shared/Form/Form.svelte';

	let {
		result,
		onconflict
	}: {
		// The remote form's reactive result. We handle the two recoverable, in-place
		// outcomes the booking wizard can signal: a slot taken between selection and
		// submit (`conflict`), and an out-of-window / bad-time input (`validationError`).
		result: { conflict?: boolean; validationError?: string } | undefined;
		onconflict: () => void;
	} = $props();

	const ctx = getFormContext()!;

	// Act once per result. The remote form hands back a fresh object for each
	// submission, so reference identity distinguishes a new signal from the same
	// one re-read on a later render.
	let handled: object | undefined;

	$effect(() => {
		if (!result || result === handled) return;
		const message = result.conflict
			? 'That time slot was just taken. Please choose another.'
			: result.validationError;
		if (!message) return;
		handled = result;
		toast.error(message);
		ctx.goToStep(0);
		onconflict();
	});
</script>
