import type { MailboxProviderId } from "@crm/auth/scopes";
import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { ManagedContinue } from "./managed-continue";
import { OriginNote } from "./origin-note";
import { SocialSignIn } from "./social-sign-in";
import { type SsoProvider, SsoSignIn } from "./sso-sign-in";

export const metadata: Metadata = {
	title: "Sign in",
};

type SignInOptions = {
	google: boolean;
	microsoft: boolean;
	pramaanKeySet: boolean;
	appUrl: string;
	managedAuthUrl: string | null;
	providers: SsoProvider[];
};

async function signInOptions(): Promise<SignInOptions | null> {
	try {
		return await getServerQueryClient().fetchQuery(
			getServerTrpc().sso.signInOptions.queryOptions(),
		);
	} catch (error) {
		unstable_rethrow(error);
		console.error("Sign-in: could not read the sign-in options.", error);
		return null;
	}
}

async function currentSession() {
	try {
		return await getSession();
	} catch (error) {
		unstable_rethrow(error);
		console.error("Sign-in: could not read the session.", error);
		return null;
	}
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
	return (
		<AuthShell>
			<Suspense
				fallback={
					<AuthHeading
						title="Welcome back"
						description="Sign in with your account to continue."
					/>
				}
			>
				<SignIn searchParams={searchParams} />
			</Suspense>
		</AuthShell>
	);
}

async function SignIn({
	searchParams,
}: Pick<PageProps<"/sign-in">, "searchParams">) {
	const [session, options, { method }] = await Promise.all([
		currentSession(),
		signInOptions(),
		searchParams,
	]);

	if (session) {
		redirect("/");
	}

	const configured: MailboxProviderId[] = [];
	if (options?.google ?? true) configured.push("google");
	if (options?.microsoft ?? false) configured.push("microsoft");

	const providers = options?.providers ?? [];
	const managedAuthUrl = options?.managedAuthUrl ?? null;

	const insisted = configured.find((provider) => provider === method);
	const showSso = providers.length > 0 && insisted === undefined;
	const social =
		insisted !== undefined
			? [insisted]
			: providers.length === 0
				? configured
				: [];

	// A different origin than APP_URL is refused at the first cookie-bearing
	// auth POST, so say so here whatever the sign-in state is.
	const originNote = options ? <OriginNote appUrl={options.appUrl} /> : null;

	if (!showSso && social.length === 0) {
		if (options && !options.pramaanKeySet) {
			return (
				<>
					<AuthHeading
						title="One thing missing"
						description="Add PRAMAAN_API_KEY to .env"
					/>

					<p className="text-center text-muted-foreground text-sm/5">
						Paste your key into the .env file at the root of this install and
						restart. Sign-in, research, enrichment and connected apps all run
						through that one key — nothing else needs an account.
					</p>

					{originNote}
				</>
			);
		}

		if (managedAuthUrl) {
			return (
				<>
					<AuthHeading
						title="Welcome"
						description="Sign in with your account to continue."
					/>

					<ManagedContinue authUrl={managedAuthUrl} />

					{originNote}
				</>
			);
		}

		return (
			<>
				<AuthHeading
					title="No way in yet"
					description="This CRM has no sign-in method configured, so nobody can get in — including you."
				/>

				<p className="text-center text-muted-foreground text-sm/5">
					Set GOOGLE_CLIENT_ID — or MICROSOFT_CLIENT_ID — in the root .env file
					and restart, and connect the matching sign-in account to the platform
					(with PRAMAAN_API_KEY set). Sign-in codes are exchanged through
					Pramaan, so no client secret lives in this install. Your own identity
					provider can be added from Settings once somebody is signed in.
				</p>

				{originNote}
			</>
		);
	}

	return (
		<>
			<AuthHeading
				title="Welcome back"
				description="Sign in with your account to continue."
			/>

			{originNote}
			{showSso ? <SsoSignIn providers={providers} /> : null}
			{social.map((provider) => (
				<SocialSignIn key={provider} provider={provider} />
			))}
		</>
	);
}
