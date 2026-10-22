// Open-web research with citations, through Pramaan. Answers questions from the live web and
// finds the pages a person or company lives on. Replaces the old answer-engine client; the
// `ask()` shape callers know is kept.

import { text as answerText, type Caps } from "@crm/pramaan";
import { currentFresh } from "./focus";
import { pramaan, pramaanEnabled } from "./pramaan";

export type Answer = {
	text: string;
	citations: string[];
};

type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string };

export function researchEnabled(): boolean {
	return pramaanEnabled();
}

export type AskOptions = {
	mode?: "fast" | "thorough";
	system?: string;
};

export async function ask(
	question: string,
	options: AskOptions = {},
): Promise<Outcome<Answer>> {
	const api = pramaan();
	if (!api) return { ok: false, reason: "Pramaan is not configured." };

	const messages: Caps.LlmMessage[] = [
		...(options.system
			? [{ role: "system" as const, content: options.system }]
			: []),
		{ role: "user" as const, content: question },
	];

	try {
		const response = await api.webAnswers({
			...(currentFresh() ? { fresh: true } : {}),
			task: options.system ? `${options.system}\n\n${question}` : question,
			mode: options.mode ?? "fast",
		});

		const text = answerText(response.answer) ?? JSON.stringify(response.answer);

		if (!text.trim())
			return { ok: false, reason: "The research came back empty." };

		return {
			ok: true,
			data: {
				text,
				citations: response.sources.map((source) => source.url),
			},
		};
	} catch (error) {
		return { ok: false, reason: describe(error) };
	}
}

export function describe(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
