import { Spinner } from "@crm/ui/components/spinner";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ManagedReturn } from "./managed-return";

export const metadata: Metadata = {
	title: "Finishing sign-in",
};

export default function ManagedReturnPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-svh items-center justify-center">
					<Spinner size="lg" />
				</div>
			}
		>
			<BackendAddress />
		</Suspense>
	);
}

async function BackendAddress() {
	// Dynamic: the backend address comes from the API at request time (the
	// same boot that provisioned it).
	await connection();

	let authUrl: string | null = null;
	try {
		const { getServerQueryClient, getServerTrpc } = await import(
			"@/lib/trpc/server"
		);
		const options = await getServerQueryClient().fetchQuery(
			getServerTrpc().sso.signInOptions.queryOptions(),
		);
		authUrl = options.managedAuthUrl;
	} catch {
		authUrl = null;
	}

	if (!authUrl) {
		return (
			<div className="flex min-h-svh items-center justify-center p-6 text-center text-muted-foreground text-sm">
				The sign-in backend is not available right now. Start again from the
				sign-in page.
			</div>
		);
	}

	return <ManagedReturn authUrl={authUrl} />;
}
