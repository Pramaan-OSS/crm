import { apiKey } from "@better-auth/api-key";
import { sso } from "@better-auth/sso";
import { db } from "@crm/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
	type GenericOAuthOptions,
	genericOAuth,
} from "better-auth/plugins/generic-oauth";
import { organization } from "better-auth/plugins/organization";
import { z } from "zod";
import { API_KEY_EXPIRATION, API_KEY_HEADER, API_KEY_PREFIX } from "./api-keys";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { env } from "./env";
import { managedPramaan, managedTokenClaims } from "./managed";
import { ensureWorkspaceMembership } from "./organization";
import {
	GOOGLE_PROVIDER_ID,
	IDENTITY_SCOPES,
	MICROSOFT_PROVIDER_ID,
} from "./scopes";
import { notifySignedIn } from "./signed-in";
import {
	exchangeSignInCode,
	identityFromTokenHandle,
	type SocialProviderKey,
} from "./social-exchange";
import {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
} from "./workspace";

// Sign-in runs through the platform: the app redirects to the provider with its public
// client id, and `auth.social.exchange` redeems the code — the platform holds the
// builder's connected sign-in account and its secret, so this process never touches a
// provider token endpoint and never sees a provider token.
function socialExchangeConfig(): GenericOAuthOptions["config"] {
	const config: GenericOAuthOptions["config"] = [];

	if (env.google) {
		const hostedDomain = primaryWorkspaceDomain();
		config.push({
			providerId: GOOGLE_PROVIDER_ID,
			clientId: env.google.clientId,
			authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
			scopes: [...IDENTITY_SCOPES],
			...(hostedDomain ? { authorizationUrlParams: { hd: hostedDomain } } : {}),
			async getToken(data) {
				return exchangeSignInCode("google" satisfies SocialProviderKey, data);
			},
			async getUserInfo(tokens) {
				return identityFromTokenHandle(tokens.accessToken);
			},
		});
	}

	if (env.microsoft) {
		config.push({
			providerId: MICROSOFT_PROVIDER_ID,
			clientId: env.microsoft.clientId,
			authorizationUrl: `https://login.microsoftonline.com/${env.microsoft.tenantId}/oauth2/v2.0/authorize`,
			scopes: [...IDENTITY_SCOPES],
			prompt: "select_account",
			async getToken(data) {
				return exchangeSignInCode(
					"microsoft" satisfies SocialProviderKey,
					data,
				);
			},
			async getUserInfo(tokens) {
				return identityFromTokenHandle(tokens.accessToken);
			},
		});
	}

	return config;
}

// Managed sign-in: the person signs in on the platform-provisioned backend
// (their browser holds that session; the app proxies it same-origin), hands
// this endpoint the session token, and gets the normal local session after
// the platform verifies the token and this app applies its own allow-list.
export const MANAGED_PROVIDER_ID = "managed";

const managedSignIn = () => ({
	id: "managed-sign-in",
	endpoints: {
		managedExchange: createAuthEndpoint(
			"/managed/exchange",
			{
				method: "POST",
				body: z.object({ token: z.string().min(10).max(8192) }),
				// No form-CSRF origin check: the one-time session token in the body
				// is the proof of authority here, and some browsers omit Origin on
				// same-origin POSTs, which the origin check would refuse.
			},
			async (c) => {
				const client = managedPramaan();
				if (!client) {
					throw new APIError("BAD_REQUEST", {
						message:
							"Managed sign-in is not available: PRAMAAN_API_KEY is not set.",
					});
				}

				const verify = await client
					.authTokenVerify({ token: c.body.token })
					.catch(() => null);
				if (!verify?.valid || !verify.userId) {
					throw new APIError("UNAUTHORIZED", {
						message: "That sign-in could not be verified. Try again.",
					});
				}

				// The verified result names no email: read the claims from the token
				// itself (the signature is already checked), and require the payload's
				// subject to be the very user the platform answered with.
				const claims = managedTokenClaims(c.body.token);
				if (!claims || claims.sub !== verify.userId) {
					throw new APIError("UNAUTHORIZED", {
						message:
							"That sign-in could not be matched to your account. Try again.",
					});
				}
				const email = claims.email?.trim().toLowerCase();
				if (!email) {
					throw new APIError("UNAUTHORIZED", {
						message:
							"The signed-in account has no email address to sign in with.",
					});
				}

				if (!hasSignInAllowList()) {
					throw new APIError("FORBIDDEN", {
						message:
							'No one can sign in yet: set ALLOWED_SIGN_IN in .env to your email domain (for example ALLOWED_SIGN_IN="acme.com") and restart.',
					});
				}
				if (!isWorkspaceEmail(email)) {
					const domain = primaryWorkspaceDomain();
					throw new APIError("FORBIDDEN", {
						message: domain
							? `This CRM is private. Sign in with your @${domain} account.`
							: "This CRM is private. That address is not on the allow-list.",
					});
				}

				let user = await db.user.findUnique({ where: { email } });
				if (!user) {
					const created = await c.context.internalAdapter.createUser({
						email,
						emailVerified: claims.emailVerified ?? false,
						name: claims.name ?? "",
					});
					if (!created) {
						throw new APIError("INTERNAL_SERVER_ERROR", {
							message: "Could not create the local account for that address.",
						});
					}
					user = await db.user.findUnique({ where: { id: created.id } });
					if (!user) {
						throw new APIError("INTERNAL_SERVER_ERROR", {
							message: "Could not create the local account for that address.",
						});
					}
				}

				const account = await db.account.findFirst({
					where: { userId: user.id, providerId: MANAGED_PROVIDER_ID },
				});
				if (!account) {
					await c.context.internalAdapter.createAccount({
						userId: user.id,
						providerId: MANAGED_PROVIDER_ID,
						accountId: verify.userId,
					});
				}

				const session = await c.context.internalAdapter.createSession(user.id);
				if (!session) {
					throw new APIError("INTERNAL_SERVER_ERROR", {
						message: "Could not open a session. Try again.",
					});
				}
				const workspaceId = await ensureWorkspaceMembership(user.id);
				if (workspaceId) {
					await c.context.internalAdapter.updateSession(session.token, {
						activeOrganizationId: workspaceId,
					});
				}
				await notifySignedIn({ id: user.id, email: user.email });
				await setSessionCookie(c, { session, user });

				return c.json({ user: { id: user.id, email: user.email } });
			},
		),
	},
});

export const auth = betterAuth({
	appName: "CRM",
	baseURL: env.apiUrl,

	database: prismaAdapter(db, {
		provider: "postgresql",
	}),

	emailAndPassword: {
		enabled: false,
	},

	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: [GOOGLE_PROVIDER_ID, MICROSOFT_PROVIDER_ID],
		},
	},

	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},

	rateLimit: {
		enabled: true,
		storage: "database",
	},

	advanced: {
		cookiePrefix: AUTH_COOKIE_PREFIX,

		useSecureCookies: env.isProduction,
		...(env.cookieDomain && {
			crossSubDomainCookies: {
				enabled: true,
				domain: env.cookieDomain,
			},
		}),
	},

	trustedOrigins: [...env.trustedOrigins],

	plugins: [
		managedSignIn(),

		genericOAuth({
			config: socialExchangeConfig(),
		}),

		organization({
			allowUserToCreateOrganization: false,
			disableOrganizationDeletion: true,
			creatorRole: "owner",

			schema: {
				organization: {
					additionalFields: {
						website: {
							type: "string",
							required: false,
						},
					},
				},
			},
		}),

		sso({
			organizationProvisioning: { disabled: true },
		}),

		apiKey({
			apiKeyHeaders: API_KEY_HEADER,
			defaultPrefix: API_KEY_PREFIX,
			enableSessionForAPIKeys: true,
			requireName: true,
			defaultKeyLength: 32,
			maximumNameLength: 64,
			rateLimit: { enabled: false },
			keyExpiration: {
				maxExpiresIn: API_KEY_EXPIRATION.maxDays,
				minExpiresIn: API_KEY_EXPIRATION.minDays,
			},
		}),
	],

	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					if (!hasSignInAllowList()) {
						throw new APIError("FORBIDDEN", {
							message:
								'No one can sign in yet: set ALLOWED_SIGN_IN in .env to your email domain (for example ALLOWED_SIGN_IN="acme.com") and restart.',
						});
					}

					if (!isWorkspaceEmail(user.email)) {
						const domain = primaryWorkspaceDomain();
						throw new APIError("FORBIDDEN", {
							message: domain
								? `This CRM is private. Sign in with your @${domain} account.`
								: "This CRM is private. That address is not on the allow-list.",
						});
					}

					return { data: user };
				},
			},
		},

		session: {
			create: {
				before: async (session) => {
					const workspaceId = await ensureWorkspaceMembership(session.userId);

					return {
						data: { ...session, activeOrganizationId: workspaceId ?? null },
					};
				},

				after: async (session) => {
					const user = await db.user.findUnique({
						where: { id: session.userId },
						select: { id: true, email: true },
					});

					if (user) await notifySignedIn(user);
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];
