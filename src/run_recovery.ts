import { readFile } from "node:fs/promises";
import { infraiFromEnvironment } from "./infrai_client.js";
import { runRecovery } from "./recovery_run.js";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: npm run recover -- recovery.json");

const input = JSON.parse(await readFile(inputPath, "utf8"));
console.log(JSON.stringify(await runRecovery(infraiFromEnvironment(), input), null, 2));
