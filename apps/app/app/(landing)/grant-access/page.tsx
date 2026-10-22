import { type MailboxProviderId, mailboxGrantsNeeded } from "@crm/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireSession, signInAccounts } from "@/lib/session";
import { GrantAccess } from "./grant-access";

export const metadata: Metadata = {
	title: "Grant access",
};

export const instant = false;

const DESCRIPTION = {
	google:
		"Connecting gives the app full access to your Gmail and access to your Calendar. This app only reads mail threads and meetings onto the right company — it never sends mail from your account.",
	microsoft:
		"Connecting may give the app full access to your Microsoft 365 account. This app only reads Outlook mail onto the right company.",
} satisfies Record<MailboxProviderId, string>;

const BOTH =
	"Connecting gives the app access to your mail and calendar. This app only reads mail threads and meetings onto the right company.";

export default async function GrantAccessPage() {
	const { user } = await requireSession();

	const providers = mailboxGrantsNeeded(await signInAccounts(user.id));

	if (providers.length === 0) {
		redirect("/");
	}

	const only = providers.length === 1 ? providers[0] : undefined;

	return (
		<AuthShell>
			<AuthHeading
				title="One more step"
				description={(only ? DESCRIPTION[only] : undefined) ?? BOTH}
			/>

			<GrantAccess providers={providers} />

			<p className="text-center text-muted-foreground text-sm/5">
				Only conversations with companies in the CRM are stored. Personal mail
				is discarded without being saved.
			</p>
		</AuthShell>
	);
}
