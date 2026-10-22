import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeField } from "../lib/fields";
import { focusOn } from "../lib/focus";

export default defineTool({
	description:
		"Write a custom-field value from evidence matching its brief. Read list_fields first; manual fields refuse.",
	inputSchema: z.object({
		entity: z.enum(["COMPANY", "CONTACT", "DEAL"]),
		recordId: z.string().describe("The id of the company, contact or deal."),
		key: z
			.string()
			.describe("The field's key, exactly as list_fields reports it."),
		value: z
			.union([z.string(), z.number(), z.boolean(), z.null()])
			.describe(
				"The value. A select takes the option's label, a date takes YYYY-MM-DD, and null clears it.",
			),
	}),
	async execute({ entity, recordId, key, value }) {
		if (entity === "COMPANY") focusOn({ companyId: recordId });
		if (entity === "CONTACT") focusOn({ contactId: recordId });

		return writeField({ entity, recordId, key, value });
	},
});
