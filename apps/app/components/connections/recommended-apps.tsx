"use client";

import GoogleLogo from "@crm/ui/components/brand-logos/google";
import MicrosoftLogo from "@crm/ui/components/brand-logos/microsoft";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "@/lib/trpc/client";

type SourceRow = {
	source: string;
	connected: boolean;
	status: string | null;
	lastError: string | null;
};

type GoogleStatus = {
	linked: boolean;
	sources: readonly SourceRow[];
};

type MicrosoftStatus = {
	linked: boolean;
	sources: readonly SourceRow[];
};

type RowStatus = "Connected" | "Not connected" | "Needs reconnecting";

export type RecommendedAppRow = {
	key: string;
	name: string;
	brings: string;
	status: RowStatus;
	action:
		| { kind: "manage"; href: string }
		| {
				kind: "connect";
				router: "google";
				source: "gmail" | "calendar";
				href: string;
		  }
		| {
				kind: "connect";
				router: "microsoft";
				source: "outlook";
				href: string;
		  };
};

function sourceStatus(source: SourceRow | undefined): RowStatus {
	if (!source) return "Not connected";
	if (source.status === "NEEDS_RECONNECT" || source.lastError)
		return "Needs reconnecting";
	return source.connected ? "Connected" : "Not connected";
}

/**
 * The apps this CRM actually uses — each connected account is charged
 * monthly, so nothing speculative is listed.
 */
export function recommendedAppRows({
	google,
	microsoft,
	slug,
}: {
	google: GoogleStatus;
	microsoft: MicrosoftStatus;
	slug: string;
}): RecommendedAppRow[] {
	const bySource = (sources: readonly SourceRow[], key: string) =>
		sources.find((source) => source.source === key);

	const gmail: SourceRow | undefined = bySource(google.sources, "gmail");
	const calendar: SourceRow | undefined = bySource(google.sources, "calendar");
	const outlook: SourceRow | undefined = bySource(microsoft.sources, "outlook");

	return [
		{
			key: "gmail",
			name: "Gmail",
			brings: "Email threads with the companies in your pipeline",
			status: sourceStatus(gmail),
			action: gmail?.connected
				? { kind: "manage", href: `/${slug}/settings/connections/google` }
				: {
						kind: "connect",
						router: "google",
						source: "gmail",
						href: `/${slug}/settings/connections/google`,
					},
		},
		{
			key: "calendar",
			name: "Google Calendar",
			brings: "Meetings, with the company and contact attached",
			status: sourceStatus(calendar),
			action: calendar?.connected
				? { kind: "manage", href: `/${slug}/settings/connections/google` }
				: {
						kind: "connect",
						router: "google",
						source: "calendar",
						href: `/${slug}/settings/connections/google`,
					},
		},
		{
			key: "outlook",
			name: "Outlook",
			brings: "Outlook email and meetings, with the people on it",
			status: sourceStatus(outlook),
			action: outlook?.connected
				? { kind: "manage", href: `/${slug}/settings/connections/microsoft` }
				: {
						kind: "connect",
						router: "microsoft",
						source: "outlook",
						href: `/${slug}/settings/connections/microsoft`,
					},
		},
	];
}

export function RecommendedApps({
	google,
	microsoft,
	slug,
}: {
	google: GoogleStatus;
	microsoft: MicrosoftStatus;
	slug: string;
}) {
	const trpc = useTRPC();
	const rows = recommendedAppRows({ google, microsoft, slug });

	const googleConnect = useMutation(
		trpc.google.connect.mutationOptions({
			onSuccess: (result) => {
				if (result.connectUrl) {
					window.location.assign(result.connectUrl);
					return;
				}
			},
		}),
	);
	const microsoftConnect = useMutation(
		trpc.microsoft.connect.mutationOptions({
			onSuccess: (result) => {
				if (result.connectUrl) {
					window.location.assign(result.connectUrl);
					return;
				}
			},
		}),
	);

	const connect = (
		row: Extract<RecommendedAppRow["action"], { kind: "connect" }>,
	) => {
		const redirectUrl = `${window.location.origin}${row.href}`;
		if (row.router === "google")
			googleConnect.mutate({ source: row.source, redirectUrl });
		else microsoftConnect.mutate({ redirectUrl });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Recommended apps</CardTitle>
				<CardDescription>
					What this CRM reads, once you connect it. Each connected account is
					billed monthly by the platform.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col divide-y">
				{rows.map((row) => {
					const action = row.action;
					return (
						<div
							key={row.key}
							className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0"
						>
							<div className="flex min-w-0 flex-col gap-1">
								<div className="flex items-center gap-2">
									{row.key === "outlook" ? (
										<MicrosoftLogo className="size-4 shrink-0" />
									) : (
										<GoogleLogo className="size-4 shrink-0" />
									)}
									<span className="font-medium text-sm">{row.name}</span>
									<StatusIndicator
										size="sm"
										tone={
											row.status === "Connected"
												? "success"
												: row.status === "Needs reconnecting"
													? "warning"
													: "neutral"
										}
										label={row.status}
									/>
								</div>
								<p className="truncate text-muted-foreground text-xs">
									{row.brings}
								</p>
							</div>
							{action.kind === "connect" ? (
								<Button
									size="sm"
									variant="outline"
									disabled={
										googleConnect.isPending || microsoftConnect.isPending
									}
									onClick={() => connect(action)}
									type="button"
								>
									Connect
								</Button>
							) : (
								<Button asChild size="sm" variant="ghost">
									<Link href={action.href}>Manage</Link>
								</Button>
							)}
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}
