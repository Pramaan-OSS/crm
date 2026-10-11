import {
	AGENT_ACTION_TYPES,
	type AgentActionType,
} from "@crm/validation/agent-manifest";

export const AGENT_ACTION_EXECUTORS = {
	[AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE]: "create_crm_activity",
	[AGENT_ACTION_TYPES.RUN_SUMMARY]: "finish_run",
} as const satisfies Record<AgentActionType, string>;

export function isAgentActionType(value: string): value is AgentActionType {
	return Object.hasOwn(AGENT_ACTION_EXECUTORS, value);
}

export type AgentActionDependency = {
	readonly id: string;
	readonly label: string;
	readonly resourceId: string;
	readonly fix: string;
};

export function actionDependency(
	_type: AgentActionType,
): AgentActionDependency | null {
	return null;
}
