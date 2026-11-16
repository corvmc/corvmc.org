import { migrationImage } from './migration-image';

/** Builds the full-replay image before any worker starts, so no test or hook pays for it. */
export default function setup() {
	migrationImage();
}
