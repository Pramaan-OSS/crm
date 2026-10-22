// Seeds just enough for the headless Playwright specs: the workspace, one user
// with a session (the specs set its token as the auth cookie), and optional
// records. Run with `bun <this file> <command>` from anywhere in the repo.

import { db, Prisma } from "@crm/db";

const WORKSPACE_ID = "workspace";
const WORKSPACE_SLUG = "workspace";
const SESSION_DAYS = 7;

async function workspace() {
	return db.organization.upsert({
		where: { id: WORKSPACE_ID },
		create: {
			id: WORKSPACE_ID,
			name: "CRM",
			slug: WORKSPACE_SLUG,
			createdAt: new Date(),
		},
		update: {},
		select: { id: true },
	});
}

async function user(email: string) {
	const id = `pw_${email.replace(/[^a-z0-9]/g, "_")}`;
	const row = await db.user.upsert({
		where: { email },
		create: { id, name: "Playwright", email, emailVerified: true },
		update: {},
		select: { id: true },
	});
	const org = await workspace();
	await db.member.upsert({
		where: {
			organizationId_userId: { organizationId: org.id, userId: row.id },
		},
		create: {
			id: `pw_member_${row.id}`,
			organizationId: org.id,
			userId: row.id,
			role: "owner",
			createdAt: new Date(),
		},
		update: { role: "owner" },
	});
	return row;
}

async function session(email: string) {
	const row = await user(email);
	const token = `pw_session_${Math.random().toString(36).slice(2)}`;
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
	await db.session.create({
		data: { id: `pw_${token}`, token, expiresAt, userId: row.id },
	});
	return token;
}

const commands: Record<string, () => Promise<unknown>> = {
	session: async () => {
		const email = process.argv[3] ?? "playwright@example.com";
		return { token: await session(email), email };
	},
	company: async () => {
		const email = process.argv[3] ?? "playwright@example.com";
		const owner = await user(email);
		const domain = `pw-${Date.now()}.test`;
		const row = await db.company.create({
			data: {
				name: "Playwright Co",
				domain,
				ownerId: owner.id,
				enrichmentStatus: "SKIPPED",
			},
			select: { id: true },
		});
		return { id: row.id, domain };
	},
	contact: async () => {
		const email = process.argv[3] ?? "playwright@example.com";
		const owner = await user(email);
		const address = `pw-${Date.now()}@example.test`;
		const row = await db.contact.create({
			data: {
				firstName: "Playwright",
				email: address,
				ownerId: owner.id,
				enrichmentStatus: "SKIPPED",
			},
			select: { id: true },
		});
		return { id: row.id };
	},
	deal: async () => {
		const email = process.argv[3] ?? "playwright@example.com";
		const owner = await user(email);
		const company = await db.company.create({
			data: {
				name: `Playwright deal co ${Date.now()}`,
				domain: `pw-deal-${Date.now()}.test`,
				ownerId: owner.id,
				enrichmentStatus: "SKIPPED",
			},
			select: { id: true },
		});
		const row = await db.deal.create({
			data: {
				name: `Playwright deal ${Date.now()}`,
				ownerId: owner.id,
				companyId: company.id,
			},
			select: { id: true },
		});
		return { id: row.id };
	},
	reset: async () => {
		await db.user.deleteMany({ where: { id: { startsWith: "pw_" } } });
		await db.company.deleteMany({
			where: { domain: { endsWith: ".pw.test" } },
		});
		await db.contact.deleteMany({
			where: { email: { startsWith: "pw-" } },
		});
		await db.deal.deleteMany({
			where: { name: { startsWith: "Playwright deal" } },
		});
		return { reset: true };
	},
};

const command = process.argv[2] ?? "";
const run = commands[command];
if (!run) {
	console.error(
		`Unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`,
	);
	process.exit(1);
}

try {
	const result = await run();
	console.log(`RESULT ${JSON.stringify(result)}`);
} catch (error) {
	console.error(
		error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error,
	);
	process.exit(1);
}
