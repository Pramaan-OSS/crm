import "@crm/env/load";

import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Same localhost default the API uses (compose Postgres on host port 54329),
// so `prisma generate` (db postinstall) works on a fresh clone before ./start
// has run. An explicit DATABASE_URL in .env or the environment always wins.
process.env.DATABASE_URL ??=
	"postgresql://postgres:postgres@localhost:54329/crm?schema=public";

export default defineConfig({
	schema: path.join("prisma", "schema.prisma"),
	migrations: {
		path: path.join("prisma", "migrations"),
		seed: "bun run prisma/seed.ts",
	},
	datasource: {
		url: env("DATABASE_URL"),
	},
});
