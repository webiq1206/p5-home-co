import { runP5Acceptance, QA_CONFIRMATION } from "../lib/p5/cliAcceptance.ts";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (value.startsWith("--")) args.set(value.slice(2), process.argv[i + 1]?.startsWith("--") ? "true" : (process.argv[++i] || "true"));
}
const mode = (args.get("mode") || "prepare") as "prepare" | "live";
runP5Acceptance({
  mode,
  baseUrl: args.get("base-url"),
  email: args.get("email"),
  scope: args.get("scope"),
  stateFile: args.get("state-file"),
  confirm: args.get("confirm"),
  confirmAgain: args.get("confirm-again"),
  timeoutMs: args.has("timeout-ms") ? Number(args.get("timeout-ms")) : undefined,
  output: message => console.log(message),
}).then(result => {
  if (mode === "prepare") console.log("Live confirmation text:", QA_CONFIRMATION);
  else console.log(result.message);
}).catch(error => {
  console.error(error instanceof Error ? error.message : "Acceptance runner failed.");
  process.exitCode = 1;
});