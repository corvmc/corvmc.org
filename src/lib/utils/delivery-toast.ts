import { toast } from 'svelte-sonner';

/**
 * The toast for a save that also owed a message: the success text only when the
 * outbox reports the message sent. The save stands either way (#2819).
 */
export function toastDelivery(
	result: unknown,
	copy: { sent: string; notSent: string },
	key: 'messageSent' | 'sent' = 'messageSent'
): void {
	if ((result as Record<string, unknown> | undefined)?.[key] === true) toast.success(copy.sent);
	else toast.warning(copy.notSent);
}
