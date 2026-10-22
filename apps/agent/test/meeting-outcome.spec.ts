import { expect, it } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";
import {
	meetingContext,
	meetingStatements,
	prepareMeeting,
} from "../agent/lib/meeting-outcome";

it("keeps private context in the input and the exact options in the estimate and run", async () => {
	const fake = new FakePramaan();
	fake.routeOutcomes({
		get: () => ({ available: true }),
		estimate: () => ({
			canRun: true,
			plan: "meeting",
			priceMinMicro: 1,
			priceMaxMicro: 2,
			steps: [],
		}),
		run: () => ({
			status: "done",
			completeness: "partial",
			result: {
				brief: ["The caller discussed a renewal."],
				briefSources: [{ callerSupplied: true }],
			},
			evidence: {},
			missing: [{ field: "news" }],
		}),
	});
	const input = {
		domain: "example.test",
		privateContext: "The caller discussed a renewal.",
		personName: "Sam Example",
	};
	expect((await prepareMeeting(fake, input)).state).toBe("estimate");
	const result = await prepareMeeting(fake, input, {
		confirm: true,
		plan: "meeting",
	});
	expect(result.state).toBe("done");
	if (result.state === "done")
		expect(meetingStatements(result.report.result)[0].callerSupplied).toBe(
			true,
		);
	for (const call of fake.outcomeCalls.filter((c) => c.verb !== "get")) {
		expect(call.input).toEqual(input);
		expect(call.opts?.options).toEqual({
			brief: true,
			news: true,
			posts: false,
		});
	}
	expect(fake.calls).toHaveLength(0);
});
it("withholds statements without source labels", () => {
	expect(meetingStatements({ brief: ["Unsupported claim"] })).toEqual([]);
	expect(
		meetingStatements({
			brief: ["Checked public fact"],
			briefSources: [{ callerSupplied: false }],
		})[0].callerSupplied,
	).toBe(false);
});

const dealHistory = {
	deal: {
		name: "Renewal",
		stage: "negotiation",
		amount: 12000,
		currency: "USD",
	},
	stageHistory: [
		{ from: "qualified", to: "negotiation", at: "2026-10-01T12:00:00Z" },
	],
	notes: [{ body: "Budget approved." }],
};

it("renders CRM history as sentences and selects the latest message by date", () => {
	const result = meetingContext(
		[
			null,
			{
				...dealHistory,
				deal: { ...dealHistory.deal, ...{ id: "private-deal-id" } },
			},
		],
		[
			{
				subject: "Renewal terms",
				lastMessageAt: "2026-10-03T12:00:00Z",
				messages: [
					{
						sentAt: "2026-10-03T12:00:00Z",
						body: "Please send the revised proposal.\nBudget is approved.",
					},
					{ sentAt: "2026-10-02T12:00:00Z", body: "Old message." },
				],
			},
		],
		[{ startsAt: "2026-10-04T12:00:00Z", title: "Renewal review" }],
	);
	expect(result.privateContext).toContain(
		"Deal Renewal is in stage negotiation, with value 12000 USD.",
	);
	expect(result.privateContext).toContain(
		"On 2026-10-01, the stage changed from qualified to negotiation.",
	);
	expect(result.privateContext).toContain("Deal note: Budget approved.");
	expect(result.privateContext).toContain(
		"Email thread on 2026-10-03 about Renewal terms. Latest message: Please send the revised proposal. Budget is approved.",
	);
	expect(result.privateContext).toContain(
		"Meeting on 2026-10-04: Renewal review.",
	);
	expect(result.privateContext).not.toContain("Old message");
	expect(result.privateContext).not.toContain("private-deal-id");
	expect(result.cut).toBe(false);
});

it("removes contact details and URLs even from selected free-text fields", () => {
	const privateText =
		"Contact sam@example.test +44 7700 900123 https://example.test/private www.example.test 123e4567-e89b-12d3-a456-426614174000";
	const result = meetingContext(
		[
			{
				...dealHistory,
				deal: { ...dealHistory.deal, name: privateText },
				notes: [{ body: privateText }],
			},
		],
		[
			{
				subject: privateText,
				lastMessageAt: "2026-10-03",
				messages: [{ sentAt: "2026-10-03", body: privateText }],
			},
		],
		[{ startsAt: "2026-10-04", title: privateText }],
	);
	for (const secret of [
		"sam@example.test",
		"7700",
		"example.test",
		"123e4567",
	]) {
		expect(result.privateContext).not.toContain(secret);
	}
	expect(result.privateContext).toContain("2026-10-04");
});

it("reserves context for each source and reports shortened history", () => {
	const result = meetingContext(
		[{ ...dealHistory, notes: [{ body: "x".repeat(9000) }] }],
		Array.from({ length: 10 }, () => ({
			subject: "Proposal",
			lastMessageAt: "2026-10-03",
			messages: [{ sentAt: "2026-10-03", body: "y".repeat(9000) }],
		})),
		[{ startsAt: "2026-10-04", title: "Review ".repeat(200) }],
	);
	expect(result.privateContext.length).toBeLessThanOrEqual(4000);
	expect(result.privateContext).toContain("negotiation");
	expect(result.privateContext).toContain("Latest message: y");
	expect(result.privateContext).toContain("Meeting on 2026-10-04");
	expect(result.cut).toBe(true);
});

it("handles empty and missing optional history without invented facts", () => {
	const result = meetingContext(
		[
			null,
			{
				deal: { name: "New deal", stage: "new", amount: null, currency: "USD" },
				stageHistory: [],
				notes: [{ body: null }],
			},
		],
		[{ subject: null, lastMessageAt: "2026-10-03", messages: [] }],
		[],
	);
	expect(result.privateContext).toContain("Deal New deal is in stage new.");
	expect(result.privateContext).toContain("No message text available.");
	expect(result.privateContext).not.toContain("value");
	expect(result.cut).toBe(false);
});

it("preserves ISO dates in note text while removing phone numbers", () => {
	const result = meetingContext(
		[
			{
				...dealHistory,
				notes: [
					{ body: "On 2026-10-01 call +44 7700 900123. Follow up 2026-10-21." },
				],
			},
		],
		[],
		[],
	);
	expect(result.privateContext).toContain("On 2026-10-01 call");
	expect(result.privateContext).toContain("Follow up 2026-10-21.");
	expect(result.privateContext).not.toContain("7700");
	expect(result.cut).toBe(false);
});
