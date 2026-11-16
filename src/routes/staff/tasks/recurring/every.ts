/** "Weekly", "Every 3 weeks", "Every 10 days". */
export function every(days: number): string {
	if (days === 1) return 'Daily';
	if (days === 7) return 'Weekly';
	if (days % 7 === 0) return `Every ${days / 7} weeks`;
	return `Every ${days} days`;
}
