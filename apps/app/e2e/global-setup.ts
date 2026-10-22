import { killRepoDevServers } from "./kill-dev";

export default function globalSetup(): void {
	killRepoDevServers();
}
