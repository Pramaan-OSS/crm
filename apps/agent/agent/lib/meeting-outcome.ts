import {
	type OutcomeApproval,
	type Pramaan,
	runOutcomeFlow,
} from "@crm/pramaan";
import { z } from "zod";
export function prepareMeeting(
	api: Pramaan,
	input: {
		domain: string;
		personName?: string;
		email?: string;
		privateContext: string;
	},
	approval: OutcomeApproval = {},
) {
	return runOutcomeFlow(
		api,
		"meeting.brief",
		input,
		{ brief: true, news: true, posts: false },
		approval,
	);
}
const resultSchema = z.object({
	brief: z.array(z.string().max(400)).max(8),
	briefSources: z.array(z.object({ callerSupplied: z.boolean() })).optional(),
	notFound: z.array(z.string()).optional(),
	notChecked: z.array(z.string()).optional(),
});
export function meetingStatements(value: unknown) {
	const parsed = resultSchema.safeParse(value);
	if (!parsed.success) return [];
	// Context is always supplied here: withhold any statement lacking its source marker.
	return parsed.data.brief.flatMap((text, index) => {
		const source = parsed.data.briefSources?.[index];
		return source
			? [
					{
						text,
						callerSupplied: source.callerSupplied,
						sourceNote: source.callerSupplied
							? "Caller-supplied CRM history; not independently verified public research."
							: "Checked public research.",
					},
				]
			: [];
	});
}

type ContextDeal = {
	deal: {
		name: string;
		stage: string;
		amount: number | null;
		currency: string;
	};
	stageHistory: { from: string | null; to: string | null; at: string }[];
	notes: { body: string | null }[];
};
type ContextThread = {
	subject: string | null;
	lastMessageAt: string;
	messages: { sentAt: string; body: string | null }[];
};

/** Reserve room for each local source inside the platform writing step's 4,000-character cap. */
export function meetingContext(
	deals: (ContextDeal | null)[],
	correspondence: ContextThread[],
	meetings: { startsAt: string; title: string | null }[],
) {
	let cut = false;
	const clean = (value: string | null) =>
		(value ?? "")
			.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, "")
			.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "")
			.replace(
				/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
				"",
			)
			.replace(/\b\d{4}-\d{2}-\d{2}\b|\+?\d[\d ().-]{6,}\d/g, (match) =>
				/^\d{4}-\d{2}-\d{2}$/.test(match) ? match : "",
			)
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	const date = (value: string) => value.slice(0, 10);
	const dealText = deals
		.flatMap((history) => {
			if (!history) return [];
			const deal = history.deal;
			return [
				`Deal ${clean(deal.name)} is in stage ${clean(deal.stage)}${deal.amount === null ? "" : `, with value ${deal.amount} ${clean(deal.currency)}`}.`,
				...history.stageHistory.map(
					(change) =>
						`On ${date(change.at)}, the stage changed from ${clean(change.from) || "unspecified"} to ${clean(change.to) || "unspecified"}.`,
				),
				...history.notes.flatMap((note) => {
					const text = clean(note.body);
					return text ? [`Deal note: ${text}`] : [];
				}),
			];
		})
		.join("\n");
	const threadText = correspondence
		.map((thread) => {
			const latest = thread.messages.reduce<
				ContextThread["messages"][number] | undefined
			>(
				(current, message) =>
					!current || message.sentAt > current.sentAt ? message : current,
				undefined,
			);
			const body = clean(latest?.body ?? null);
			if (body.length > 240) cut = true;
			const gist = body.length > 240 ? `${body.slice(0, 237)}...` : body;
			return `Email thread on ${date(latest?.sentAt ?? thread.lastMessageAt)} about ${clean(thread.subject) || "an untitled subject"}. Latest message: ${gist || "No message text available."}`;
		})
		.join("\n");
	const meetingText = meetings
		.map(
			(meeting) =>
				`Meeting on ${date(meeting.startsAt)}: ${clean(meeting.title) || "Untitled meeting"}.`,
		)
		.join("\n");
	// Sentences only: the brief writer quotes whole lines, so a heading line would become a statement.
	const section = (text: string, limit: number) => {
		if (text.length > limit) cut = true;
		return text.slice(0, limit);
	};
	return {
		privateContext: [
			section(dealText, 1600),
			section(threadText, 1600),
			section(meetingText, 400),
		]
			.filter(Boolean)
			.join("\n\n"),
		cut,
	};
}
