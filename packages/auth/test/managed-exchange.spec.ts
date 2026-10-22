import { afterAll, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { FakePramaan } from "@crm/pramaan/fake";
import { auth } from "../src/auth";
import {
	resetManagedForTests,
	setManagedPramaanForTests,
} from "../src/managed";

// The managed-sign-in exchange, against the platform's live-confirmed shapes:
// auth.token.verify answers { valid, userId, ... } with no email; the email
// comes from the verified token's payload, whose `sub` must equal the
// returned userId. GET authUrl/token supplies the JWT (client side; not
// exercised here).

const b64url = (value: object) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

const makeJwt = (payload: Record<string, unknown>): string =>
	`${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;

const TOKEN_OK = makeJwt({
	sub: "managed-user-1",
	email: "managed.exchange.spec@example.test",
	emailVerified: true,
	name: "Managed Rep",
});
const TOKEN_OTHER_SUBJECT = makeJwt({
	sub: "managed-user-2",
	email: "managed.exchange.spec@example.test",
});
const TOKEN_NO_EMAIL = makeJwt({ sub: "managed-user-1" });
const MANAGED_USER = "managed-user-1";
const EMAIL = "managed.exchange.spec@example.test";

const fake = new FakePramaan({
	"auth.token.verify": (input) => {
		const token = (input as { token: string }).token;
		// Any structurally intact JWT verifies (the platform checks the
		// signature); a made-up string answers valid false. The userId comes
		// back as the platform knows it — which the payload's sub must match.
		const genuine = token.split(".").length === 3 && token.includes(".");
		return {
			valid: genuine,
			userId: genuine ? MANAGED_USER : undefined,
		};
	},
});

const exchange = async (body: unknown, headers: Record<string, string> = {}) =>
	auth.handler(
		new Request("http://localhost:3001/api/auth/managed/exchange", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);

const cleanup = async () => {
	const users = await db.user.findMany({
		where: { email: EMAIL },
		select: { id: true },
	});
	for (const user of users) {
		await db.session.deleteMany({ where: { userId: user.id } });
		await db.account.deleteMany({ where: { userId: user.id } });
		await db.member.deleteMany({ where: { userId: user.id } });
	}
	await db.user.deleteMany({ where: { email: EMAIL } });
};

afterAll(async () => {
	await cleanup();
	resetManagedForTests();
	await db.$disconnect();
});

describe("the managed sign-in exchange", () => {
	it(
		"opens the normal local session for a verified managed user",
		async () => {
			setManagedPramaanForTests(fake);
			process.env.ALLOWED_SIGN_IN = "example.test";
			await cleanup();

			const response = await exchange({ token: TOKEN_OK });
			expect(response.status).toBe(200);

			const setCookie = response.headers.getSetCookie().join("\n");
			expect(setCookie).toContain("session_token");

			const user = await db.user.findUnique({ where: { email: EMAIL } });
			expect(user).not.toBeNull();
			const userId = user?.id as string;
			expect(user?.emailVerified).toBe(true);
			expect(user?.name).toBe("Managed Rep");

			const account = await db.account.findFirst({
				where: { userId, providerId: "managed" },
			});
			expect(account?.accountId).toBe(MANAGED_USER);

			const session = await db.session.findFirst({
				where: { userId },
			});
			expect(session?.token).toBeTruthy();

			const member = await db.member.findFirst({
				where: { userId },
			});
			expect(member).not.toBeNull();
		},
		{ timeout: 60_000 },
	);

	it("reuses the local user on a second sign-in instead of duplicating", async () => {
		process.env.ALLOWED_SIGN_IN = "example.test";

		const before = await db.user.findUnique({ where: { email: EMAIL } });
		const response = await exchange({ token: TOKEN_OK });
		expect(response.status).toBe(200);

		const after = await db.user.findUnique({ where: { email: EMAIL } });
		expect(after?.id).toBe(before?.id);
	});

	it("refuses a token the platform will not verify", async () => {
		const response = await exchange({ token: "forged-token" });
		expect(response.status).toBe(401);

		const body = (await response.json()) as { message?: string };
		expect(body.message).toContain("could not be verified");
	});

	it("refuses a token whose payload names another subject than verify answered", async () => {
		const response = await exchange({ token: TOKEN_OTHER_SUBJECT });
		expect(response.status).toBe(401);

		const body = (await response.json()) as { message?: string };
		expect(body.message).toContain("matched to your account");
	});

	it("refuses a verified token that carries no email address", async () => {
		const response = await exchange({ token: TOKEN_NO_EMAIL });
		expect(response.status).toBe(401);

		const body = (await response.json()) as { message?: string };
		expect(body.message).toContain("no email address");
	});

	it("fails closed when nobody is allowed to sign in at all", async () => {
		process.env.ALLOWED_SIGN_IN = "";

		const response = await exchange({ token: TOKEN_OK });
		expect(response.status).toBe(403);

		const body = (await response.json()) as { message?: string };
		expect(body.message).toContain("ALLOWED_SIGN_IN");
	});

	it("keeps addresses outside the allow-list out", async () => {
		process.env.ALLOWED_SIGN_IN = "acme.com";

		const response = await exchange({ token: TOKEN_OK });
		expect(response.status).toBe(403);
	});

	it("exchanges without an Origin header, the way some browsers post", async () => {
		process.env.ALLOWED_SIGN_IN = "example.test";
		setManagedPramaanForTests(fake);

		const response = await exchange({ token: TOKEN_OK });
		expect(response.status).toBe(200);
	});

	it("says what is missing when there is no client at all", async () => {
		setManagedPramaanForTests(null);

		const response = await exchange({ token: TOKEN_OK });
		expect(response.status).toBe(400);

		const body = (await response.json()) as { message?: string };
		expect(body.message).toContain("PRAMAAN_API_KEY");
	});
});
