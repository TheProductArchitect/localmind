/**
 * Lightweight branding mirror for the Electron shell.
 * Written whenever settings change so main process can read assistant_name
 * without loading better-sqlite3 inside Electron's Node ABI.
 */

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/paths";
import { getSettings } from "@/lib/db/queries";

export function writeBrandingMirror(): void {
  try {
    const s = getSettings();
    const file = path.join(DATA_DIR, "branding.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          assistant_name: s.assistant_name || "Assistant",
          updated_at: Date.now(),
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    /* best-effort */
  }
}
