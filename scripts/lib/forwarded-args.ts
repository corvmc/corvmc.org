/**
 * The flags a `pnpm <script> -- <flag>` invocation meant to forward.
 *
 * `--` is the documented way to pass a flag through a pnpm script, but pnpm
 * forwards the separator itself rather than eating it, so the wrapped tool is
 * handed a literal `--` alongside the flags. Both tools behind it read a bare
 * argument as a filename filter, and both fail *green* on it:
 *
 * - `playwright test` matches nothing and reports "No tests found", so a shard
 *   that silently ran zero tests passes.
 * - vitest treats everything after the separator as a positional filter, so
 *   `--run` stops meaning one-shot and `--project=` stops narrowing. In CI that
 *   is invisible (vitest defaults to run mode off a TTY); locally the suite sits
 *   in watch mode across all three projects, which reads as a hung gate.
 *
 * Dropping the separator makes `pnpm test:unit -- --run` and
 * `pnpm test:unit --run` mean the same thing, which is what the command tables
 * in `CLAUDE.md` and `docs/development/conventions.md` promise.
 */
export function forwardedArgs(argv: string[] = process.argv.slice(2)): string[] {
	return argv.filter((arg) => arg !== '--');
}
