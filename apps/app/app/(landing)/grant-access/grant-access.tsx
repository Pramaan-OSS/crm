"use client";

import GoogleLogo from "@crm/ui/components/brand-logos/google";
import MicrosoftLogo from "@crm/ui/components/brand-logos/microsoft";
import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import type { FC, SVGProps } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { signOutAndRedirect } from "@/lib/sign-out";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type MailboxProviderId = "google" | "microsoft";

type ProviderGrant = {
	label: string;
	Logo: FC<SVGProps<SVGSVGElement>>;
};

const PROVIDERS = {
	google: {
		label: "Grant Google access",
		Logo: GoogleLogo,
	},
	microsoft: {
		label: "Grant Microsoft access",
		Logo: MicrosoftLogo,
	},
} as const satisfies Record<MailboxProviderId, ProviderGrant>;

type ConnectResult = RouterOutputs["google"]["connect"];

export function GrantAccess({
	providers,
}: {
	providers: readonly MailboxProviderId[];
}) {
	const trpc = useTRPC();
	const [pending, setPending] = useState<MailboxProviderId | null>(null);

	function fail(message?: string) {
		setPending(null);
		toast.error(message ?? "Could not reach the provider.");
	}

	// Mailbox access connects through the platform's hosted sign-in link: the
	// API starts it, the browser goes there, and the CRM picks the connection
	// up on return.
	const googleConnect = useMutation(
		trpc.google.connect.mutationOptions({
			onSuccess: (result: ConnectResult) => {
				if (result.connectUrl) {
					window.location.assign(result.connectUrl);
					return;
				}
				fail(result.error ?? undefined);
			},
			onError: (error) => fail(error.message),
		}),
	);
	const microsoftConnect = useMutation(
		trpc.microsoft.connect.mutationOptions({
			onSuccess: (result: ConnectResult) => {
				if (result.connectUrl) {
					window.location.assign(result.connectUrl);
					return;
				}
				fail(result.error ?? undefined);
			},
			onError: (error) => fail(error.message),
		}),
	);

	function handleGrant(provider: MailboxProviderId) {
		setPending(provider);
		const origin = window.location.origin;
		if (provider === "google") {
			googleConnect.mutate({
				source: "gmail",
				redirectUrl: `${origin}/grant-access`,
			});
		} else {
			microsoftConnect.mutate({
				redirectUrl: `${origin}/grant-access`,
			});
		}
	}

	const single = providers.length === 1;

	return (
		<div className="flex flex-col gap-3">
			{providers.map((provider) => {
				const { label, Logo } = PROVIDERS[provider];

				return (
					<Button
						key={provider}
						className="w-full"
						disabled={
							googleConnect.isPending ||
							microsoftConnect.isPending ||
							(pending !== null && pending !== provider)
						}
						onClick={() => {
							handleGrant(provider);
						}}
						type="button"
					>
						{pending === provider ? (
							<Spinner data-icon="inline-start" />
						) : (
							<Logo data-icon="inline-start" className="size-4" />
						)}
						{single ? "Grant access" : label}
					</Button>
				);
			})}

			<Button
				className="w-full"
				onClick={() => {
					signOutAndRedirect().catch(() => toast.error("Could not sign out."));
				}}
				type="button"
				variant="ghost"
			>
				Sign out
			</Button>
		</div>
	);
}
