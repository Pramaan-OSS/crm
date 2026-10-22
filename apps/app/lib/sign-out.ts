"use client";

import { signOut } from "@crm/auth/client";
import { toast } from "sonner";

export async function signOutAndRedirect() {
	const { error } = await signOut();

	if (error) {
		// The auth server refuses cookie-bearing POSTs from an origin outside
		// APP_URL/trustedOrigins; the app itself still works, so say where to be.
		if (error.status === 403) {
			toast.error(
				`Sign-out was refused from ${window.location.origin}. Open the app at the origin set as APP_URL and try again.`,
			);
			return;
		}
		toast.error(error.message ?? "Could not sign out.");
		return;
	}

	window.location.assign("/sign-in");
}
