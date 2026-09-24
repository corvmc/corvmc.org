import { command } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mintConnectionToken } from '$lib/server/finance/terminal-service';

/**
 * A Stripe Terminal connection token for the door phone (#612).
 *
 * A `command`, not a `query`: the token is single-use, so a cached or
 * deduplicated read would hand the SDK one it has already spent. The plugin
 * asks through `RequestedConnectionToken` and gets this via `setConnectionToken`.
 */
export const getTerminalConnection = command(async () => {
	await requireCapability('finance.collect');
	return mintConnectionToken();
});
