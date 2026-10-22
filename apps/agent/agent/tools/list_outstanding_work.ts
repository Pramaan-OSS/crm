import { defineTool } from "eve/tools";
import { z } from "zod";
import { contactsNeedingWork } from "../lib/crm";

export default defineTool({
	description:
		"List contacts missing names, backgrounds or social research, with the missing work for each.",
	inputSchema: z.object({
		limit: z.number().int().min(1).max(25).default(10),
	}),
	async execute({ limit }) {
		const contacts = await contactsNeedingWork(limit);
		return { count: contacts.length, contacts };
	},
});
