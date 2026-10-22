// All authored tool definitions, including disabled entries. Startup validates
// these without executing a tool; tests also verify discovery stays complete.
import { type JsonObject, normalizeJsonSchema } from "@crm/pramaan";
import tool0 from "../subagents/agent_builder/tools/bash";
import tool1 from "../subagents/agent_builder/tools/glob";
import tool2 from "../subagents/agent_builder/tools/grep";
import tool3 from "../subagents/agent_builder/tools/inspect_context";
import tool4 from "../subagents/agent_builder/tools/read_file";
import tool5 from "../subagents/agent_builder/tools/save_agent_draft";
import tool6 from "../subagents/agent_builder/tools/todo";
import tool7 from "../subagents/agent_builder/tools/web_fetch";
import tool8 from "../subagents/agent_builder/tools/web_search";
import tool9 from "../subagents/agent_builder/tools/write_agent_file";
import tool10 from "../subagents/agent_builder/tools/write_file";
import tool11 from "../subagents/agent_runner/tools/ask_question";
import tool12 from "../subagents/agent_runner/tools/bash";
import tool13 from "../subagents/agent_runner/tools/create_crm_activity";
import tool14 from "../subagents/agent_runner/tools/finish_run";
import tool15 from "../subagents/agent_runner/tools/glob";
import tool16 from "../subagents/agent_runner/tools/grep";
import tool17 from "../subagents/agent_runner/tools/inspect_run";
import tool18 from "../subagents/agent_runner/tools/query_crm";
import tool19 from "../subagents/agent_runner/tools/read_crm_record";
import tool20 from "../subagents/agent_runner/tools/read_file";
import tool21 from "../subagents/agent_runner/tools/todo";
import tool22 from "../subagents/agent_runner/tools/web_fetch";
import tool23 from "../subagents/agent_runner/tools/web_search";
import tool24 from "../subagents/agent_runner/tools/write_file";
import tool25 from "../tools/agent";
import tool26 from "../tools/archive_field";
import rootbash from "../tools/bash";
import tool27 from "../tools/enrich_company";
import tool28 from "../tools/fetch_contact_photo";
import tool29 from "../tools/find_contact_socials";
import tool30 from "../tools/get_contact_work_history";
import tool31 from "../tools/get_linkedin_profile";
import rootglob from "../tools/glob";
import rootgrep from "../tools/grep";
import tool32 from "../tools/identify_contact";
import tool33 from "../tools/list_deals";
import tool34 from "../tools/list_fields";
import tool35 from "../tools/list_outstanding_work";
import tool36 from "../tools/manage_fields";
import prepareMeetingTool from "../tools/prepare_meeting";
import tool37 from "../tools/read_company_history";
import tool38 from "../tools/read_crm_history";
import tool39 from "../tools/read_deal_history";
import rootread_file from "../tools/read_file";
import tool40 from "../tools/record_fact";
import tool41 from "../tools/record_job_change";
import tool42 from "../tools/research_company";
import tool43 from "../tools/research_person";
import tool44 from "../tools/resolve_linkedin_profile";
import tool45 from "../tools/schedule_recheck";
import tool46 from "../tools/search_crm";
import tool47 from "../tools/set_chat_title";
import tool48 from "../tools/set_contact_socials";
import tool49 from "../tools/set_field_value";
import roottodo from "../tools/todo";
import rootweb_fetch from "../tools/web_fetch";
import tool50 from "../tools/write_brief";
import rootwrite_file from "../tools/write_file";
import tool51 from "../tools/write_workspace_profile";
export const registeredTools: ReadonlyArray<{
	name: string;
	definition: { inputSchema?: unknown; kind?: string };
}> = [
	{ name: "tools/bash.ts", definition: rootbash },
	{ name: "tools/glob.ts", definition: rootglob },
	{ name: "tools/grep.ts", definition: rootgrep },
	{ name: "tools/read_file.ts", definition: rootread_file },
	{ name: "tools/write_file.ts", definition: rootwrite_file },
	{ name: "tools/todo.ts", definition: roottodo },
	{ name: "tools/web_fetch.ts", definition: rootweb_fetch },

	{ name: "subagents/agent_builder/tools/bash.ts", definition: tool0 },
	{ name: "subagents/agent_builder/tools/glob.ts", definition: tool1 },
	{ name: "subagents/agent_builder/tools/grep.ts", definition: tool2 },
	{
		name: "subagents/agent_builder/tools/inspect_context.ts",
		definition: tool3,
	},
	{ name: "subagents/agent_builder/tools/read_file.ts", definition: tool4 },
	{
		name: "subagents/agent_builder/tools/save_agent_draft.ts",
		definition: tool5,
	},
	{ name: "subagents/agent_builder/tools/todo.ts", definition: tool6 },
	{ name: "subagents/agent_builder/tools/web_fetch.ts", definition: tool7 },
	{ name: "subagents/agent_builder/tools/web_search.ts", definition: tool8 },
	{
		name: "subagents/agent_builder/tools/write_agent_file.ts",
		definition: tool9,
	},
	{ name: "subagents/agent_builder/tools/write_file.ts", definition: tool10 },
	{ name: "subagents/agent_runner/tools/ask_question.ts", definition: tool11 },
	{ name: "subagents/agent_runner/tools/bash.ts", definition: tool12 },
	{
		name: "subagents/agent_runner/tools/create_crm_activity.ts",
		definition: tool13,
	},
	{ name: "subagents/agent_runner/tools/finish_run.ts", definition: tool14 },
	{ name: "subagents/agent_runner/tools/glob.ts", definition: tool15 },
	{ name: "subagents/agent_runner/tools/grep.ts", definition: tool16 },
	{ name: "subagents/agent_runner/tools/inspect_run.ts", definition: tool17 },
	{ name: "subagents/agent_runner/tools/query_crm.ts", definition: tool18 },
	{
		name: "subagents/agent_runner/tools/read_crm_record.ts",
		definition: tool19,
	},
	{ name: "subagents/agent_runner/tools/read_file.ts", definition: tool20 },
	{ name: "subagents/agent_runner/tools/todo.ts", definition: tool21 },
	{ name: "subagents/agent_runner/tools/web_fetch.ts", definition: tool22 },
	{ name: "subagents/agent_runner/tools/web_search.ts", definition: tool23 },
	{ name: "subagents/agent_runner/tools/write_file.ts", definition: tool24 },
	{ name: "tools/agent.ts", definition: tool25 },
	{ name: "tools/archive_field.ts", definition: tool26 },
	{ name: "tools/enrich_company.ts", definition: tool27 },
	{ name: "tools/fetch_contact_photo.ts", definition: tool28 },
	{ name: "tools/find_contact_socials.ts", definition: tool29 },
	{ name: "tools/get_contact_work_history.ts", definition: tool30 },
	{ name: "tools/get_linkedin_profile.ts", definition: tool31 },
	{ name: "tools/identify_contact.ts", definition: tool32 },
	{ name: "tools/list_deals.ts", definition: tool33 },
	{ name: "tools/list_fields.ts", definition: tool34 },
	{ name: "tools/list_outstanding_work.ts", definition: tool35 },
	{ name: "tools/manage_fields.ts", definition: tool36 },
	{ name: "tools/read_company_history.ts", definition: tool37 },
	{ name: "tools/read_crm_history.ts", definition: tool38 },
	{ name: "tools/prepare_meeting.ts", definition: prepareMeetingTool },
	{ name: "tools/read_deal_history.ts", definition: tool39 },
	{ name: "tools/record_fact.ts", definition: tool40 },
	{ name: "tools/record_job_change.ts", definition: tool41 },
	{ name: "tools/research_company.ts", definition: tool42 },
	{ name: "tools/research_person.ts", definition: tool43 },
	{ name: "tools/resolve_linkedin_profile.ts", definition: tool44 },
	{ name: "tools/schedule_recheck.ts", definition: tool45 },
	{ name: "tools/search_crm.ts", definition: tool46 },
	{ name: "tools/set_chat_title.ts", definition: tool47 },
	{ name: "tools/set_contact_socials.ts", definition: tool48 },
	{ name: "tools/set_field_value.ts", definition: tool49 },
	{ name: "tools/write_brief.ts", definition: tool50 },
	{ name: "tools/write_workspace_profile.ts", definition: tool51 },
];
export function normalizedAuthoredSchema(
	schema: unknown,
	name: string,
	direction: "input" | "output" = "input",
) {
	const standard = (
		schema as {
			"~standard"?: {
				jsonSchema?: Record<string, (options: { target: string }) => unknown>;
			};
		}
	)?.["~standard"];
	const raw =
		standard?.jsonSchema?.[direction]?.({ target: "draft-07" }) ?? schema;
	return normalizeJsonSchema(raw ?? {}, name) as JsonObject;
}
export function validateRegisteredToolSchemas() {
	for (const tool of registeredTools) {
		if (tool.definition.kind === "eve:disabled-tool") continue;
		normalizedAuthoredSchema(tool.definition.inputSchema, `Tool ${tool.name}`);
	}
}
