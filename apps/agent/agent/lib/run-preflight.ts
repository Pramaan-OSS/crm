import { db } from "@crm/db";
import {
	type AgentManifest,
	InvalidAgentManifest,
	parseAgentManifest,
} from "@crm/validation/agent-manifest";

export const DEPENDENCY_UNAVAILABLE = "DEPENDENCY_UNAVAILABLE";

export async function missingRunDependencies(
	_manifest: AgentManifest,
): Promise<string[]> {
	return [];
}

export async function runDependencyFailure(
	versionId: string,
): Promise<string | null> {
	const version = await db.agentVersion.findUnique({
		where: { id: versionId },
		select: { manifest: true },
	});
	if (!version) return null;

	try {
		parseAgentManifest(version.manifest);
	} catch (error) {
		return error instanceof InvalidAgentManifest ? error.message : null;
	}

	return null;
}
