// Kill leftover dev processes from an earlier run: eve refuses a second
// instance and a port already in use makes the webServer's stack fail to start.
// Only this repo's dev processes are touched — never anything else on the ports.
// The tree is killed by process GROUP, twice, so supervisors (next dev,
// bun --watch) cannot respawn their children.

import { execSync } from "node:child_process";
import { join } from "node:path";

function holdersOf(ports: string): number[] {
	return execSync(`lsof -ti ${ports} 2>/dev/null || true`, {
		encoding: "utf8",
		shell: "/bin/zsh",
	})
		.split("\n")
		.map((line) => Number(line.trim()))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function cwdOf(pid: number): string {
	try {
		return (
			execSync(`lsof -p ${pid} 2>/dev/null | grep " cwd "`, {
				encoding: "utf8",
				shell: "/bin/zsh",
			})
				.split("\n")
				.map((line) => line.trim())
				.filter(
					(line) => line.endsWith("cwd") === false && line.includes(" cwd "),
				)
				.map((line) => line.slice(line.lastIndexOf(" ") + 1))[0] ?? ""
		);
	} catch {
		return "";
	}
}

function killTree(pid: number): void {
	try {
		const pgid = Number(
			execSync(`ps -o pgid= -p ${pid}`, { encoding: "utf8" }).trim(),
		);
		if (Number.isInteger(pgid) && pgid > 1) {
			process.kill(-pgid, "SIGKILL");
			return;
		}
	} catch {
		// fall through to the single process
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// already gone
	}
}

function inRepo(pid: number): boolean {
	const cwd = cwdOf(pid);
	return cwd.includes("pramaan-crm") || cwd === "";
}

export function killRepoDevServers(): void {
	for (let pass = 0; pass < 2; pass += 1) {
		const holders = holdersOf("-ti :3100 -ti :3101 -ti :2000").filter(inRepo);
		if (holders.length === 0) return;
		for (const pid of holders) killTree(pid);
		const settle = Number(process.env.KILL_DEV_SETTLE_MS ?? 600);
		execSync(`sleep ${Math.max(settle, 100) / 1000}`);
	}
}
