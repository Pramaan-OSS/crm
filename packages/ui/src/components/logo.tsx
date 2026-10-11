import type * as React from "react";

/**
 * The product mark: an ink tile with one dot. Adapts to its surroundings —
 * the tile takes the current text colour, the dot takes the surface behind it.
 */
const Logo = (props: React.SVGProps<SVGSVGElement>) => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={64}
		height={64}
		viewBox="0 0 64 64"
		fill="none"
		aria-label="Agentic CRM"
		{...props}
	>
		<rect width="64" height="64" rx="14" fill="currentColor" />
		<circle cx="32" cy="32" r="9" fill="var(--background, #ffffff)" />
	</svg>
);
export default Logo;
