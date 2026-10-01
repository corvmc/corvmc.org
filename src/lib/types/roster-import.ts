/** What a staff roster import did with each address. */
export interface RosterImportResult {
	/** Had an account; now active. Includes anyone whose invitation or application this settled. */
	added: string[];
	/** No account; an invitation email went out. */
	invited: string[];
	alreadyMembers: string[];
	/** No account and a live invitation already — not re-sent. */
	alreadyInvited: string[];
	/** Not an address, or an address whose account is deactivated. */
	invalid: { entry: string; reason: string }[];
	duplicates: number;
}
