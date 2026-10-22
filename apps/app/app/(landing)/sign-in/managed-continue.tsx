"use client";

import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { useState } from "react";
import {
	createManagedClient,
	MANAGED_RETURN_PATH,
} from "@/lib/managed-auth-client";

/**
 * The one sign-in method an install with no provider of its own offers: the
 * managed sign-in backend. Same look as the own-client buttons; the action
 * runs on the backend the platform provisions. Whoever gets in is still
 * decided by ALLOWED_SIGN_IN, on return.
 */
export function ManagedContinue({ authUrl }: { authUrl: string }) {
	const client = createManagedClient(authUrl);
	const [pending, setPending] = useState<
		"social" | "sign-in" | "sign-up" | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const [mode, setMode] = useState<"social" | "email">("social");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");

	function fail(message?: string) {
		setPending(null);
		setError(message ?? "Could not reach the sign-in service. Try again.");
	}

	/** Hands the backend's JWT to the API, which opens the local session. */
	async function exchangeJwtFromBackend(): Promise<boolean> {
		// The JWT comes from the backend's /token with its session cookie
		// (SameSite=None; Partitioned, so the browser sends it here). The
		// sign-up/sign-in body token is the opaque session token, not a JWT.
		const tokenResponse = await fetch(`${authUrl}/token`, {
			credentials: "include",
			headers: { accept: "application/json" },
		});
		if (!tokenResponse.ok) return false;
		const body = (await tokenResponse.json().catch(() => null)) as {
			token?: string;
		} | null;
		if (!body?.token) return false;

		const response = await fetch("/api/auth/managed/exchange", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: body.token }),
		});
		if (!response.ok) {
			const exchanged = (await response.json().catch(() => null)) as {
				message?: string;
			} | null;
			fail(exchanged?.message ?? "Signing in did not complete. Start again.");
			return true;
		}
		window.location.assign("/");
		return true;
	}

	async function social() {
		setPending("social");
		setError(null);
		try {
			const result = await client.signIn.social({
				provider: "google",
				callbackURL: `${window.location.origin}${MANAGED_RETURN_PATH}`,
			});
			if (result?.data?.url) {
				window.location.assign(result.data.url);
				return;
			}
			fail();
		} catch {
			fail();
		}
	}

	async function submit(mode: "sign-in" | "sign-up") {
		setPending(mode);
		setError(null);
		try {
			const result =
				mode === "sign-up"
					? await client.signUp.email({
							email,
							password,
							name: name.trim() || email,
						})
					: await client.signIn.email({ email, password });
			if (result?.error) {
				fail(
					mode === "sign-up"
						? "Could not create that account on the sign-in backend. Check the address and password (at least 8 characters)."
						: "That address and password did not match. Try again, or create an account.",
				);
				return;
			}
			const exchanged = await exchangeJwtFromBackend();
			if (!exchanged) window.location.assign(MANAGED_RETURN_PATH);
		} catch {
			fail();
		}
	}

	return (
		<div className="flex w-full flex-col items-center gap-3">
			<Button
				className="w-full"
				disabled={pending !== null}
				onClick={() => {
					void social();
				}}
				type="button"
				variant="outline"
			>
				<GoogleLogo data-icon="inline-start" className="size-4" />
				Continue with Google
			</Button>

			{mode === "social" ? (
				<button
					className="text-muted-foreground text-sm underline underline-offset-4"
					onClick={() => setMode("email")}
					type="button"
				>
					Sign in with email
				</button>
			) : (
				<div className="flex w-full flex-col gap-3 pt-2">
					{pending === null || pending === "sign-up" ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="managed-name">Name</Label>
							<Input
								autoComplete="name"
								id="managed-name"
								onChange={(event) => setName(event.target.value)}
								value={name}
							/>
						</div>
					) : null}
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="managed-email">Email</Label>
						<Input
							autoComplete="email"
							id="managed-email"
							onChange={(event) => setEmail(event.target.value)}
							type="email"
							value={email}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="managed-password">Password</Label>
						<Input
							autoComplete={
								pending === "sign-up" ? "new-password" : "current-password"
							}
							id="managed-password"
							onChange={(event) => setPassword(event.target.value)}
							type="password"
							value={password}
						/>
					</div>
					<div className="flex w-full gap-2">
						<Button
							className="flex-1"
							disabled={pending !== null}
							onClick={() => {
								void submit("sign-up");
							}}
							type="button"
							variant="outline"
						>
							{pending === "sign-up" ? "Creating…" : "Create account"}
						</Button>
						<Button
							className="flex-1"
							disabled={pending !== null}
							onClick={() => {
								void submit("sign-in");
							}}
							type="button"
						>
							{pending === "sign-in" ? "Signing in…" : "Sign in"}
						</Button>
					</div>
					<button
						className="text-muted-foreground text-sm underline underline-offset-4"
						onClick={() => setMode("social")}
						type="button"
					>
						Back
					</button>
				</div>
			)}

			{error ? <p className="text-muted-foreground text-sm">{error}</p> : null}
		</div>
	);
}
