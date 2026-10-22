"use client";

import { useEffect, useState } from "react";

/**
 * The auth server refuses cookie-bearing sign-in and sign-out POSTs from any
 * origin outside APP_URL (plus its loopback aliases). When the browser is on a
 * different origin than the one the API was told about, say so here — before
 * the person signs in and discovers it at sign-out.
 */
export function originNote(
	origin: string | null,
	appUrl: string,
): string | null {
	if (!origin || origin === appUrl) return null;
	return `You opened this app at ${origin} but it is served as ${appUrl}. Open the served address instead, or set APP_URL in the root .env file to this origin and restart — otherwise signing in and out is refused.`;
}

export function OriginNote({ appUrl }: { appUrl: string }) {
	const [origin, setOrigin] = useState<string | null>(null);

	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);

	const note = originNote(origin, appUrl);
	if (!note) return null;

	return <p className="text-center text-muted-foreground text-sm/5">{note}</p>;
}
