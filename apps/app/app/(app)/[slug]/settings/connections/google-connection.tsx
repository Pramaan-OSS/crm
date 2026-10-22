"use client";

import Launch from "@carbon/icons-react/es/Launch";
import Warning from "@carbon/icons-react/es/Warning";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@crm/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@crm/ui/components/alert-dialog";
import GoogleLogo from "@crm/ui/components/brand-logos/google";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { Switch } from "@crm/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConnectionNotice } from "@/components/connections/connection-notice";
import { LocalRelativeTime } from "@/components/local-date-time";
import { isSyncing, SYNC_POLL_MS } from "@/lib/sync-status";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";

const CHAIN_GUARD_KEY = "google-calendar-chain";

const SOURCES = {
	calendar: {
		label: "Meetings",
		autoCreate: "Add the company and contact when you meet someone new",
	},
	gmail: {
		label: "Email",
		autoCreate: "Add the company and contact when you reply to someone new",
	},
} as const;

/**
 * After a Gmail connect, the platform starts only the mailbox. When the user
 * comes back with mail connected and the calendar not, chain the calendar
 * connection once — the original Google consent granted both together.
 */
export function calendarChainNeeded(
	sources: readonly { source: string; connected: boolean }[],
): boolean {
	const gmail = sources.find((source) => source.source === "gmail");
	const calendar = sources.find((source) => source.source === "calendar");
	return Boolean(gmail?.connected) && calendar?.connected === false;
}

const RESOLVE_HOSTS = [
	"console.cloud.google.com",
	"console.developers.google.com",
	"support.google.com",
	"myaccount.google.com",
];

function resolveLink(error: string): string | undefined {
	const found = error.match(/https?:\/\/[^\s)]+/)?.[0];
	if (!found) return undefined;

	try {
		const url = new URL(found);
		const allowed =
			url.protocol === "https:" &&
			RESOLVE_HOSTS.some(
				(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
			);
		return allowed ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function explain(error: string) {
	return {
		summary: error.split(/(?<=\.)\s/)[0] ?? error,
		url: resolveLink(error),
	};
}

function failureSignature(
	sources: readonly {
		source: string;
		status: string | null;
		lastError: string | null;
	}[],
): string {
	const failures: string[] = [];
	for (const source of sources) {
		if (source.status === "NEEDS_RECONNECT" || source.lastError) {
			failures.push(`${source.source}:${source.lastError ?? "reconnect"}`);
		}
	}
	return failures.sort().join("|");
}

function GoogleUnavailable() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<div className="flex items-center gap-2">
						Google
						<StatusIndicator size="sm" tone="neutral" label="Not configured" />
					</div>
				</CardTitle>
				<CardDescription>
					Set GOOGLE_CLIENT_ID in the root .env file, connect the sign-in
					account on the platform, and make sure PRAMAAN_API_KEY is set. The
					sign-in code is exchanged through Pramaan — no client secret lives
					here.
				</CardDescription>
			</CardHeader>
		</Card>
	);
}

const CONNECT_ERRORS = new Map([
	[
		"email_doesn't_match",
		"That Google account has a different email address to the one you sign in with, so it cannot be attached to your account. Connect the Google account that matches your sign-in address.",
	],
]);

function ConnectGoogle({
	slug,
	connectError,
}: {
	slug: string;
	connectError?: string;
}) {
	const trpc = useTRPC();
	const [pending, setPending] = useState(false);

	function fail(message?: string) {
		setPending(false);
		toast.error(message ?? "Could not reach Google.");
	}

	// The mailbox connects through the platform's hosted sign-in link: the API
	// starts it, the browser goes there, and the connection comes back here.
	const connect = useMutation(
		trpc.google.connect.mutationOptions({
			onSuccess: (result) => {
				if (result.connectUrl) {
					window.location.assign(result.connectUrl);
					return;
				}
				fail(result.error ?? undefined);
			},
			onError: (error) => fail(error.message),
		}),
	);

	function handleConnect() {
		setPending(true);
		const origin = window.location.origin;
		connect.mutate({
			source: "gmail",
			redirectUrl: `${origin}/${slug}/settings/connections/google`,
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<div className="flex items-center gap-2">
						Google
						<StatusIndicator size="sm" tone="neutral" label="Not connected" />
					</div>
				</CardTitle>
				<CardDescription>
					Only conversations with companies in the CRM are stored.
					<ConnectionNotice slug="google" appName="Google Workspace" />
				</CardDescription>

				<CardAction>
					<Button
						size="sm"
						disabled={pending}
						onClick={() => {
							handleConnect();
						}}
						type="button"
					>
						{pending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<GoogleLogo data-icon="inline-start" className="size-4" />
						)}
						Connect
					</Button>
				</CardAction>
			</CardHeader>

			{connectError ? (
				<CardContent>
					<Alert variant="destructive">
						<Icon icon={Warning} />
						<AlertTitle>Google did not finish connecting</AlertTitle>
						<AlertDescription>
							{CONNECT_ERRORS.get(connectError) ??
								"Google returned an error before the connection was made. Try again."}
						</AlertDescription>
					</Alert>
				</CardContent>
			) : null}
		</Card>
	);
}

export function GoogleConnection({
	slug,
	connectError,
}: {
	slug: string;
	connectError?: string;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();

	const status = useQuery({
		...trpc.google.status.queryOptions(),
		refetchInterval: (query) =>
			query.state.data?.sources.some((source) => isSyncing(source.status))
				? SYNC_POLL_MS
				: false,
	});

	const purge = useMutation(
		trpc.google.purgeSyncedData.mutationOptions({
			onSuccess: async (result) => {
				await cache.google();
				toast.success(`Removed ${result.purged} synced items.`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const revoke = useMutation(
		trpc.google.revokeAccess.mutationOptions({
			onSuccess: () =>
				window.location.assign(
					status.data?.required ? "/" : `/${slug}/settings/connections`,
				),
			onError: (error) => toast.error(error.message),
		}),
	);

	const setAutoCreate = useMutation(
		trpc.google.setAutoCreate.mutationOptions({
			onSuccess: () => cache.google({ settle: "record" }),
			onError: (error) => toast.error(error.message),
		}),
	);

	const [insistence, setInsistence] = useState(0);
	const [chainFailed, setChainFailed] = useState(false);
	const chainDone = useRef(false);

	// Gmail connects the mailbox; the calendar chains afterwards (once) so the
	// single Google consent the person just finished still covers both.
	const connect = useMutation(
		trpc.google.connect.mutationOptions({
			onSuccess: (result) => {
				if (result.connectUrl) {
					sessionStorage.setItem(CHAIN_GUARD_KEY, "done");
					window.location.assign(result.connectUrl);
					return;
				}
				setChainFailed(true);
			},
			onError: () => setChainFailed(true),
		}),
	);

	const connectSource = (source: "gmail" | "calendar") => {
		const origin = window.location.origin;
		connect.mutate({
			source,
			redirectUrl: `${origin}/${slug}/settings/connections/google`,
		});
	};

	useEffect(() => {
		if (chainFailed || chainDone.current) return;
		if (sessionStorage.getItem(CHAIN_GUARD_KEY) === "done") return;
		if (!status.data || !calendarChainNeeded(status.data.sources)) return;
		chainDone.current = true;
		sessionStorage.setItem(CHAIN_GUARD_KEY, "done");
		connect.mutate({
			source: "calendar",
			redirectUrl: `${window.location.origin}/${slug}/settings/connections/google`,
		});
	}, [status.data, chainFailed, connect, slug]);

	const syncNow = useMutation(
		trpc.google.syncNow.mutationOptions({
			onSuccess: async () => {
				const before = failureSignature(status.data?.sources ?? []);
				await cache.google();

				const after = failureSignature(
					queryClient.getQueryData(trpc.google.status.queryKey())?.sources ??
						[],
				);

				if (after && after === before) setInsistence((count) => count + 1);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!status.data) return null;

	const { sources, hasRefreshToken, configured, linked, required } =
		status.data;

	if (!configured) return <GoogleUnavailable />;
	if (!linked) return <ConnectGoogle slug={slug} connectError={connectError} />;

	const failing = sources.filter(
		(source) => source.status === "NEEDS_RECONNECT" || source.lastError,
	);
	const lastSyncedAt = sources
		.map((source) => source.lastSyncedAt)
		.filter((at): at is string => at !== null)
		.sort()
		.at(-1);

	const healthy = failing.length === 0 && hasRefreshToken;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<div className="flex items-center gap-2">
						Google
						<StatusIndicator
							size="sm"
							tone={healthy ? "success" : "warning"}
							label={healthy ? "Connected" : "Needs attention"}
						/>
					</div>
				</CardTitle>
				<CardDescription>
					Meetings and email threads land on the matching company as they
					happen.
				</CardDescription>

				<CardAction>
					<Button
						variant="contrast"
						size="sm"
						disabled={syncNow.isPending}
						onClick={() => syncNow.mutate()}
					>
						{syncNow.isPending ? "Checking…" : "Check now"}
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				{!hasRefreshToken ? (
					<Alert variant="destructive" attention={insistence}>
						<Icon icon={Warning} />
						<AlertTitle>Google did not return a refresh token</AlertTitle>
						<AlertDescription>Sign out and back in.</AlertDescription>
					</Alert>
				) : failing.length > 0 ? (
					failing.map((source) => {
						const { summary, url } = explain(
							source.lastError ?? "Google needs reconnecting.",
						);

						return (
							<Alert
								key={source.source}
								variant="destructive"
								attention={insistence}
							>
								<Icon icon={Warning} />
								<AlertTitle>
									{SOURCES[source.source].label} sync failed
								</AlertTitle>
								<AlertDescription>{summary}</AlertDescription>

								{url ? (
									<AlertAction>
										<Button variant="contrast" size="xs" asChild>
											<a href={url} target="_blank" rel="noreferrer">
												Resolve
												<Icon icon={Launch} data-icon="inline-end" />
											</a>
										</Button>
									</AlertAction>
								) : null}
							</Alert>
						);
					})
				) : (
					<p className="text-muted-foreground text-xs">
						{lastSyncedAt ? (
							<>
								Last checked <LocalRelativeTime date={lastSyncedAt} />
							</>
						) : (
							"Waiting for the first check"
						)}
					</p>
				)}

				{sources.map((source) => {
					const copy = SOURCES[source.source];

					return (
						<div
							key={source.source}
							className="flex items-center justify-between gap-6"
						>
							<Label
								htmlFor={`auto-create-${source.source}`}
								className="flex flex-col items-start gap-1"
							>
								<span className="text-sm">{copy.label}</span>
								<span className="font-normal text-muted-foreground text-xs">
									{copy.autoCreate}
								</span>
							</Label>

							{!source.connected ? (
								<Button
									variant="outline"
									size="xs"
									disabled={connect.isPending}
									onClick={() =>
										connectSource(source.source as "gmail" | "calendar")
									}
								>
									Connect
								</Button>
							) : (
								<Switch
									id={`auto-create-${source.source}`}
									checked={source.autoCreate}
									disabled={setAutoCreate.isPending}
									onCheckedChange={(enabled) =>
										setAutoCreate.mutate({ source: source.source, enabled })
									}
								/>
							)}
						</div>
					);
				})}

				<CardFooter>
					<div className="-ml-2 flex flex-wrap items-center gap-1 text-muted-foreground">
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="ghost" size="xs" disabled={purge.isPending}>
									Delete synced data
								</Button>
							</AlertDialogTrigger>

							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete synced data?</AlertDialogTitle>
									<AlertDialogDescription>
										Every email and meeting brought in from Google is removed
										from the CRM. The next check starts from now, so nothing
										deleted here comes back.
									</AlertDialogDescription>
								</AlertDialogHeader>

								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										onClick={() => purge.mutate()}
									>
										Delete
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>

						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="ghost" size="xs" disabled={revoke.isPending}>
									Revoke Google access
								</Button>
							</AlertDialogTrigger>

							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Revoke Google access?</AlertDialogTitle>
									<AlertDialogDescription>
										{required
											? "You will be signed out, and you cannot use the CRM again until you grant access."
											: "New email and meetings stop arriving. Everything already synced stays, and you can connect Google again from this page."}
									</AlertDialogDescription>
								</AlertDialogHeader>

								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction
										variant="destructive"
										onClick={() => revoke.mutate()}
									>
										Revoke
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>

						<Button variant="ghost" size="xs" asChild>
							<Link
								href="https://myaccount.google.com/permissions"
								target="_blank"
								rel="noreferrer"
							>
								Manage in your Google account
							</Link>
						</Button>
					</div>
				</CardFooter>
			</CardContent>
		</Card>
	);
}
