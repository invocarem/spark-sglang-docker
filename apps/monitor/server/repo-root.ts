/**
 * Repo root on the host (for bind-mounting `./:/workspace`). Used by launch scripts listing and stack run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function findRepoRoot(): string {
  const env = process.env.MONITOR_REPO_ROOT?.trim();
  if (env) return path.resolve(env);
  for (let depth = 3; depth <= 6; depth++) {
    const root = path.resolve(__dirname, ...Array<string>(depth).fill(".."));
    const scripts = path.join(root, "scripts");
    try {
      if (fs.statSync(scripts).isDirectory()) return root;
    } catch {
      /* try next depth */
    }
  }
  return path.resolve(__dirname, "..", "..", "..");
}
