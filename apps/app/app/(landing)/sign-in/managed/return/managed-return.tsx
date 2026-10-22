"use client";

import { Spinner } from "@crm/ui/components/spinner";
import { useEffect, useState } from "react";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import {
	fetchManagedJwt,
	SESSION_VERIFIER_PARAM,
} from "@/lib/managed-auth-client";

// The managed backend redirected back here after the person signed in. After
// an OAuth round-trip the redirect carries a one-time verifier: get-session
// is called with it to finalise the session cookie in this origin's cookie
// partition, then the JWT comes from /token and is exchanged with the API for
// the normal local session.

export function ManagedReturn({ authUrl }: { authUrl: string }) {
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	useEffect(() => {
		let cancelled = false;

		async function exchange() {
			try {
				const url = new URL(window.location.href);
				const verifier = url.searchParams.get(SESSION_VERIFIER_PARAM);
				const token = await fetchManagedJwt(authUrl, verifier);

				if (verifier) {
					url.searchParams.delete(SESSION_VERIFIER_PARAM);
					window.history.replaceState(null, "", url.toString());
				}

				if (!token) {
					setError(
						"The managed sign-in session could not be read. Close this page and start again.",
					);
					return;
				}

				const response = await fetch("/api/auth/managed/exchange", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ token }),
				});

				if (!response.ok) {
					const body = (await response.json().catch(() => null)) as {
						message?: string;
					} | null;
					setError(
						body?.message ??
							"Signing in did not complete. Start again from the sign-in page.",
					);
					return;
				}

				if (!cancelled) {
					setDone(true);
					window.location.assign("/");
				}
			} catch {
				setError(
					"Signing in did not complete. Start again from the sign-in page.",
				);
			}
		}

		exchange();
		return () => {
			cancelled = true;
		};
	}, [authUrl]);

	return (
		<AuthShell>
			{error ? (
				<>
					<AuthHeading title="Sign-in did not complete" description={error} />
					<p className="text-center text-muted-foreground text-sm/5">
						Go back to the{" "}
						<a className="underline underline-offset-4" href="/sign-in">
							sign-in page
						</a>{" "}
						and try again.
					</p>
				</>
			) : (
				<>
					<AuthHeading
						title={done ? "Signed in" : "Finishing sign-in"}
						description={
							done ? "Taking you in…" : "Checking your managed sign-in."
						}
					/>
					<div className="flex justify-center">
						<Spinner size="lg" />
					</div>
				</>
			)}
		</AuthShell>
	);
}
