import type { DirectoryReach } from '#lib/server/instructor/instructor-directory-service.js';

/** A teacher's listing as the directory would publish it, and who it would reach. */
export interface InstructorListingView {
	headline: string | null;
	blurb: string | null;
	ratesNote: string | null;
	bookingUrl: string | null;
	directoryReach: DirectoryReach;
}
