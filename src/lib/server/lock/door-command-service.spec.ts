import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryDeviceHealth = vi.fn();
const mockSendLockCommand = vi.fn();

vi.mock('./ultraloc-client', () => ({
	queryDeviceHealth: (...args: unknown[]) => mockQueryDeviceHealth(...args),
	sendLockCommand: (...args: unknown[]) => mockSendLockCommand(...args)
}));

const { operateDoor } = await import('./door-command-service');

const health = (lockState: string, online = true) => ({
	online,
	lockState,
	lockMode: 0,
	batteryLevel: 4
});

let slept = 0;
const sleep = async (ms: number) => {
	slept += ms;
};

beforeEach(() => {
	vi.clearAllMocks();
	slept = 0;
	mockSendLockCommand.mockResolvedValue({ deferredSeconds: 20 });
});

describe('operateDoor', () => {
	it('sends nothing to an offline lock, so no unlock can land later', async () => {
		mockQueryDeviceHealth.mockResolvedValue(health('Locked', false));

		const result = await operateDoor('unlock', { sleep });

		expect(result.outcome).toBe('lock_offline');
		expect(mockSendLockCommand).not.toHaveBeenCalled();
	});

	it('treats an unreadable lock as offline', async () => {
		mockQueryDeviceHealth.mockRejectedValue(new Error('500'));

		expect((await operateDoor('unlock', { sleep })).outcome).toBe('lock_offline');
		expect(mockSendLockCommand).not.toHaveBeenCalled();
	});

	it('reports unlocked once the lock state says so', async () => {
		mockQueryDeviceHealth
			.mockResolvedValueOnce(health('Locked'))
			.mockResolvedValueOnce(health('Locked'))
			.mockResolvedValueOnce(health('Unlocked'));

		const result = await operateDoor('unlock', { sleep });

		expect(result).toEqual({ outcome: 'unlocked', lockState: 'Unlocked' });
		expect(mockSendLockCommand).toHaveBeenCalledTimes(1);
		expect(mockSendLockCommand).toHaveBeenCalledWith('unlock');
		expect(slept).toBe(4000);
	});

	it('polls for as long as the ack says, then follows a stuck unlock with a lock', async () => {
		mockQueryDeviceHealth.mockResolvedValue(health('Locked'));
		mockSendLockCommand.mockResolvedValueOnce({ deferredSeconds: 6 });

		const result = await operateDoor('unlock', { sleep });

		expect(result.outcome).toBe('timed_out');
		expect(slept).toBe(6000);
		expect(mockSendLockCommand.mock.calls).toEqual([['unlock'], ['lock']]);
	});

	it('caps the wait at 20 seconds and defaults to 10 when the ack names none', async () => {
		mockQueryDeviceHealth.mockResolvedValue(health('Locked'));

		mockSendLockCommand.mockResolvedValueOnce({ deferredSeconds: 90 });
		await operateDoor('unlock', { sleep });
		expect(slept).toBe(20_000);

		slept = 0;
		mockSendLockCommand.mockResolvedValueOnce({ deferredSeconds: null });
		await operateDoor('unlock', { sleep });
		expect(slept).toBe(10_000);
	});

	it('does not follow a timed-out lock with anything', async () => {
		mockQueryDeviceHealth.mockResolvedValue(health('Unlocked'));

		const result = await operateDoor('lock', { sleep });

		expect(result.outcome).toBe('timed_out');
		expect(mockSendLockCommand.mock.calls).toEqual([['lock']]);
	});

	it('reports locked once the lock state says so', async () => {
		mockQueryDeviceHealth
			.mockResolvedValueOnce(health('Unlocked'))
			.mockResolvedValueOnce(health('Locked'));

		expect((await operateDoor('lock', { sleep })).outcome).toBe('locked');
	});

	it('keeps polling through a failed read', async () => {
		mockQueryDeviceHealth
			.mockResolvedValueOnce(health('Locked'))
			.mockRejectedValueOnce(new Error('blip'))
			.mockResolvedValueOnce(health('Unlocked'));

		expect((await operateDoor('unlock', { sleep })).outcome).toBe('unlocked');
	});

	it('times out without a follow-up when the command itself is refused', async () => {
		mockQueryDeviceHealth.mockResolvedValue(health('Locked'));
		mockSendLockCommand.mockRejectedValueOnce(new Error('BAD-REQUEST'));

		const result = await operateDoor('unlock', { sleep });

		expect(result.outcome).toBe('timed_out');
		expect(mockSendLockCommand).toHaveBeenCalledTimes(1);
		expect(slept).toBe(0);
	});
});
