import "@crm/env/load";
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { resolve } from "node:path";
import { ensureDatabaseUrl } from "@crm/db/managed";
import { checkQueuedSessionScope } from "../agent/lib/run-safety";

// When the person set no DATABASE_URL, use the managed database's saved
// address (the API boot provisions and saves it; this is a no-op when it is
// already in the environment) and otherwise fall back to the local default.
const dbOutcome = await ensureDatabaseUrl();
if (dbOutcome.managed) {
	console.log(
		`[agent] using the managed database ${dbOutcome.from === "saved" ? "saved from an earlier boot" : "provisioned this boot"}.`,
	);
}

process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@localhost:54329/crm?schema=public";
checkQueuedSessionScope(resolve(import.meta.dirname, ".."));
process.env.AGENT_RUNTIME_ROOT = resolve(import.meta.dirname, "../.runtime");

const rawPort = process.env.AGENT_PORT ?? process.env.PORT ?? "2000";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error(
		`AGENT_PORT or PORT must be a valid port, received ${rawPort}.`,
	);
}

const cli = process.platform === "win32" ? "eve.cmd" : "eve";
const mode = process.argv.includes("--dev") ? "dev" : "start";
const child = spawn(
	cli,
	[mode, ...(mode === "dev" ? ["--no-ui"] : []), "--port", String(port)],
	{
		stdio: "inherit",
		env: process.env,
	},
);

let settled = false;

const finish = (code: number) => {
	if (settled) return;
	settled = true;
	process.exitCode = code;
};

const forward = (signal: NodeJS.Signals) => {
	if (!child.killed) child.kill(signal);
};

process.once("SIGINT", forward);
process.once("SIGTERM", forward);

child.once("exit", (code, signal) => {
	const signalNumber = signal ? constants.signals[signal] : null;
	finish(code ?? (signalNumber ? 128 + signalNumber : 1));
});

child.once("error", (error) => {
	console.error(`[agent] could not start eve: ${error.message}`);
	finish(1);
});
