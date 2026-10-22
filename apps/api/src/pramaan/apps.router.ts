import { Inject } from "@nestjs/common";
import { Ctx, Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { AppsConnectionService } from "./apps-connection.service";

const searchInput = z.object({
	query: z.string().trim().min(1).max(200),
	app: z.string().min(1).max(100).optional(),
	cursor: z.string().min(1).max(4000).optional(),
	limit: z.number().int().min(1).max(50).optional(),
});
const searchOutput = z.object({
	results: z.array(
		z.object({
			app: z.string(),
			action: z.string(),
			description: z.string().optional(),
			readOnly: z.literal(true).optional(),
			inputSchema: z.unknown().optional(),
		}),
	),
	nextCursor: z.string().optional(),
});

@Router({ alias: "connectedApps" })
@UseMiddlewares(AuthMiddleware)
export class AppsRouter {
	constructor(
		@Inject(AppsConnectionService) private readonly apps: AppsConnectionService,
	) {}
	@Query({ output: z.object({ configured: z.boolean() }) })
	status() {
		return { configured: this.apps.configured() };
	}
	@Query({ input: searchInput, output: searchOutput })
	async actions(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof searchInput>,
	) {
		return this.apps.discoverActions(
			`${ctx.user.id}:${ctx.session!.session.id}`,
			input,
		);
	}
}
