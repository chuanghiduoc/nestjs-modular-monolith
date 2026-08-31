import { filetypemime } from 'magic-bytes.js';

export const SIGNATURE_SAMPLE_BYTES = 4100;

/**
 * Every type the leading bytes could be, most specific first.
 *
 * The list is returned whole rather than reduced to a verdict: one signature can
 * mean several types, and only the caller knows which of them it is prepared to
 * store. Callers take the first candidate — a file whose primary type is not
 * accepted is refused even when a later candidate would have passed, which is
 * what keeps a polyglot from entering through its second identity.
 */
export function detectMimeTypes(sample: Uint8Array): readonly string[] {
  return filetypemime(Array.from(sample));
}
