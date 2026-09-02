export function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function pickN<T>(arr: T[], n: number): T[] {
	const shuffled = [...arr].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, n);
}

export function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function ptDate(daysOffset: number, hour: number, minute = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + daysOffset);
	d.setUTCHours(hour + 7, minute, 0, 0);
	return d;
}
