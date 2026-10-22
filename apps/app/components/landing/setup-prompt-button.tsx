"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import Copy from "@carbon/icons-react/es/Copy";
import { Button } from "@crm/ui/components/button";
import { useState } from "react";

const SETUP_PROMPT =
	"Set up this repository — install the dependencies, start Postgres, create my .env from the example, and tell me which values I still need. The repository's own setup docs have the details.";

/**
 * The page's leading action: hand the whole setup to any capable assistant or
 * run it by hand. It stands where a "Get started" would, because on a repo you
 * fork rather than sign up for, taking the prompt is what getting started means.
 */
export function SetupPromptButton() {
	const [copied, setCopied] = useState(false);

	async function copy() {
		await navigator.clipboard.writeText(SETUP_PROMPT);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<Button
			variant="outline"
			size="xl"
			onClick={copy}
			aria-label="Copy the setup prompt"
		>
			<Copy data-icon="inline-start" className="size-4" />
			{copied ? "Copied to clipboard" : "Copy the setup prompt"}
			{copied ? (
				<Checkmark
					data-icon="inline-end"
					className="ml-1.5 size-3.5 text-primary"
				/>
			) : (
				<Copy
					data-icon="inline-end"
					className="ml-1.5 size-3.5 text-muted-foreground"
				/>
			)}
		</Button>
	);
}
