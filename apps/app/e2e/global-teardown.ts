import { killRepoDevServers } from "./kill-dev";

export default function globalTeardown(): void {
	killRepoDevServers();
}
