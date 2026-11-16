import { queryDeviceHealth, sendLockCommand } from './ultraloc-client';

// Opening and closing the door from a phone (#2120, decided in #2157).
//
// U-tec queues a command for an offline lock and documents no expiry or
// cancel, so an unlock sent into an outage could open the door hours later
// with nobody there. Hence the health read before sending, and a `lock` sent
// after any unlock that does not confirm: delivered in order, it closes again
// whatever the unlock eventually does.

export type DoorOutcome = 'unlocked' | 'locked' | 'timed_out' | 'lock_offline';

export interface DoorResult {
	outcome: DoorOutcome;
	/** The last `lockState` read, for the log. */
	lockState: string | null;
}

/** Used when the ack names no deferral. */
const DEFAULT_BUDGET_SECONDS = 10;
/** U-tec's stated ceiling for `st.deferredResponse`. */
const MAX_BUDGET_SECONDS = 20;
const POLL_MS = 2000;

const TARGET = { unlock: 'Unlocked', lock: 'Locked' } as const;

export interface OperateOptions {
	/** Overridable so tests do not sit through the polling. */
	sleep?: (ms: number) => Promise<void>;
	pollMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Lock or unlock, and say whether the lock confirmed it. Never throws: every
 * failure is an outcome the door page has a fallback for.
 */
export async function operateDoor(
	action: 'lock' | 'unlock',
	opts: OperateOptions = {}
): Promise<DoorResult> {
	const sleep = opts.sleep ?? realSleep;
	const pollMs = opts.pollMs ?? POLL_MS;

	let lockState: string | null = null;
	try {
		const health = await queryDeviceHealth();
		lockState = health.lockState;
		if (!health.online) return { outcome: 'lock_offline', lockState };
	} catch {
		// Not knowing is treated as offline: nothing gets queued blind.
		return { outcome: 'lock_offline', lockState };
	}

	let budgetSeconds = DEFAULT_BUDGET_SECONDS;
	try {
		const ack = await sendLockCommand(action);
		if (ack.deferredSeconds !== null) {
			budgetSeconds = Math.min(Math.max(ack.deferredSeconds, 1), MAX_BUDGET_SECONDS);
		}
	} catch {
		// Refused outright, so nothing is queued and nothing needs undoing.
		return { outcome: 'timed_out', lockState };
	}

	const deadline = budgetSeconds * 1000;
	for (let waited = 0; waited < deadline; waited += pollMs) {
		await sleep(pollMs);
		try {
			lockState = (await queryDeviceHealth()).lockState;
		} catch {
			continue;
		}
		if (lockState === TARGET[action]) {
			return { outcome: action === 'unlock' ? 'unlocked' : 'locked', lockState };
		}
	}

	if (action === 'unlock') {
		try {
			await sendLockCommand('lock');
		} catch (err) {
			console.error(
				`Failed to send the lock after an unconfirmed unlock: ${(err as Error).message}`
			);
		}
	}
	return { outcome: 'timed_out', lockState };
}
