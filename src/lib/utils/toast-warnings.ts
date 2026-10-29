import { toast } from 'svelte-sonner';

/** Toast each warning an action returned alongside its success, e.g. unscheduled items. */
export function toastWarnings(result: unknown): void {
	const warnings = (result as { warnings?: unknown } | undefined)?.warnings;
	if (!Array.isArray(warnings)) return;
	for (const w of warnings) if (typeof w === 'string') toast.warning(w);
}
