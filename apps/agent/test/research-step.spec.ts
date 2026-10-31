import { afterEach, expect, test } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";
import { createPramaanChatModel } from "../agent/lib/pramaan-chat-model";
import { readPublicPage } from "../agent/lib/read-public-page";
import { researchStepMaxTokens } from "../agent/lib/research-step";

const saved = process.env.RESEARCH_MAX_TOKENS;
afterEach(() => {
	if (saved === undefined) delete process.env.RESEARCH_MAX_TOKENS;
	else process.env.RESEARCH_MAX_TOKENS = saved;
});
test("step setting defaults to 4096 and refuses values outside platform bounds", () => {
	expect(researchStepMaxTokens("")).toBe(4096);
	for (const value of ["63", "8193", "1.5", "invalid"])
		expect(() => researchStepMaxTokens(value)).toThrow("RESEARCH_MAX_TOKENS");
	expect(researchStepMaxTokens("64")).toBe(64);
});
test("one setting caps both whole and streamed replies, never below 64", async () => {
	process.env.RESEARCH_MAX_TOKENS = "256";
	const fake = new FakePramaan({
		"llm.chat": () => ({
			text: "Found.",
			toolCalls: [],
			finishReason: "stop",
			usage: { inputTokens: 1, outputTokens: 1 },
		}),
	});
	const model = createPramaanChatModel({ pramaan: fake });
	await model.doGenerate({
		prompt: [{ role: "user", content: "Research." }],
		maxOutputTokens: 8192,
	});
	fake.routeStream(async function* () {
		yield {
			type: "done",
			result: {
				text: "Found.",
				toolCalls: [],
				finishReason: "stop",
				usage: { inputTokens: 1, outputTokens: 1 },
			},
		};
	});
	const stream = await model.doStream({
		prompt: [{ role: "user", content: "Research." }],
		maxOutputTokens: 8,
	});
	for await (const _part of stream.stream) {
	}
	expect(
		[fake.callsTo("llm.chat")[0], fake.streamCalls[0]?.input].map(
			(input) => (input as { maxTokens: number }).maxTokens,
		),
	).toEqual([256, 64]);
});
test("public page reading uses the single capability boundary and rejects credentials", async () => {
	const fake = new FakePramaan({
		"web.read": () => ({
			url: "https://example.test/",
			text: "Public facts",
			title: "Example",
			truncated: false,
		}),
	});
	expect((await readPublicPage(fake, "https://example.test/")).ok).toBe(true);
	expect(fake.callsTo("web.read")).toEqual([{ url: "https://example.test/" }]);
	await expect(
		readPublicPage(fake, "https://private:secret@example.test/"),
	).rejects.toThrow("public HTTPS");
	expect(fake.calls).toHaveLength(1);
});
