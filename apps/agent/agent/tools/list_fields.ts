import { defineTool } from "eve/tools";
import { z } from "zod";
import { listFields } from "../lib/fields";

export default defineTool({
	description:
		"Read custom-field keys, types, options and evidence briefs before setting values or claiming a field is absent.",
	inputSchema: z.object({
		entity: z
			.enum(["COMPANY", "CONTACT", "DEAL"])
			.describe("Which record type the fields belong to."),
	}),
	async execute({ entity }) {
		const fields = await listFields(entity);

		return {
			fields: fields.map((field) => ({
				key: field.key,
				label: field.label,
				type: field.type,
				agentFilled: field.agentFilled,
				brief: field.agentBrief,
				options: field.options.map((option) => option.label),
			})),
			note:
				fields.length === 0
					? "This workspace has no custom fields on this record type yet."
					: "Fields marked agentFilled false are the rep's to keep — do not write to them.",
		};
	},
});
