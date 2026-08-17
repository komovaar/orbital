import { createHash } from "node:crypto";

/**
 * Hash of an ordered list of strings.
 *
 * Parts are length-prefixed so that no combination of contents can be
 * re-segmented into a different list: ["ab", "c"] and ["a", "bc"] must not
 * collide, or a digest could miss a real change to a node's inputs.
 */
export function hash(parts: readonly string[]): string {
  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(`${part.length}:${part}`);
  }
  return digest.digest("hex");
}
