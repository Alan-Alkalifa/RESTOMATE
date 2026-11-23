import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// A shell redirect empties the target before the CLI runs, so a failed run would destroy the
// committed types. Only write once the command has succeeded.
try {
  const types = execSync("supabase gen types typescript", {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  writeFileSync(new URL("../src/database.types.ts", import.meta.url), types);
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  console.error("db:types failed; database.types.ts was left untouched.");
  process.exitCode = 1;
}
