import { defineTool } from "eve/tools";
import { z } from "zod";
import { spend } from "../lib/focus";
import { pramaan } from "../lib/pramaan";
import { readPublicPage } from "../lib/read-public-page";

export default defineTool({
	description:
		"Read a public webpage through Pramaan for company research. Never send private CRM text or credentials in an address.",
	inputSchema: z.object({
		url: z.string().url().describe("Public HTTPS page address."),
	}),
	async execute({ url }) {
		const charge = spend(1);
		if (!charge.ok) return charge;
		return readPublicPage(pramaan(), url);
	},
});
