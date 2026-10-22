import { expect, test } from "bun:test";
import { FakePramaan } from "@crm/pramaan/fake";
import { agentModel, NO_KEY_MESSAGE } from "../agent/lib/model";

// Exercise the installed runtime's actual lifecycle acceptance rule, without a
// server, scheduler, database or outside request. Authored-model mocking is off
// only while resolving so the test cannot accidentally pass on a runtime mock.
const runtime = await import(
	new URL("./context/dynamic-model-lifecycle.js", import.meta.resolve("eve"))
		.href
);

test("the step lifecycle accepts the configured platform model and generates through the fake", async () => {
	const fake = new FakePramaan({
		"llm.chat": () => ({
			text: "Resolved.",
			toolCalls: [],
			finishReason: "stop",
			usage: { inputTokens: 1, outputTokens: 1 },
		}),
	});
	const model = agentModel(() => fake);
	const values = new Map();
	const ctx = {
		get: (key: unknown) => values.get(key),
		set: (key: unknown, value: unknown) => values.set(key, value),
		setVirtualContext: (key: unknown, value: unknown) => values.set(key, value),
	};
	const previous = process.env.NODE_ENV;
	try {
		process.env.NODE_ENV = "development";
		await runtime.dispatchDynamicModelEvent({
			ctx,
			dynamicModel: {
				sourceId: "fixture-model",
				logicalPath: "agent.ts",
				eventNames: Object.keys(model.events),
			},
			event: { type: "step.started", data: {} },
			fallback: { id: "fixture-fallback" },
			messages: [],
			scope: {
				nodeId: "fixture",
				moduleMap: {
					nodes: {
						fixture: { modules: { "fixture-model": { default: { model } } } },
					},
				},
			},
		});
	} finally {
		process.env.NODE_ENV = previous;
	}
	const selected = runtime.getActiveDynamicModelSelection(ctx);
	expect(selected?.model).toBeDefined();
	expect(selected?.model).not.toBe(model.fallback);
	const reply = await selected.model.doGenerate({
		prompt: [{ role: "user", content: "Hello" }],
	});
	expect(reply.content).toEqual([{ type: "text", text: "Resolved." }]);
	expect(fake.callsTo("llm.chat")).toHaveLength(1);
});

test("fallback distinguishes an unresolved configured model from a missing key", () => {
	const configured = agentModel(() => new FakePramaan());
	expect(() => configured.fallback.doGenerate()).toThrow(
		"could not be resolved",
	);
	expect(() => agentModel(() => null).fallback.doGenerate()).toThrow(
		NO_KEY_MESSAGE,
	);
});
