// Product analytics ride on your own PostHog account. The key and host are env, not
// code: unset means nothing is sent anywhere. The browser reads the NEXT_PUBLIC_ pair
// (Next.js inlines those at build); the server accepts either spelling.

export const POSTHOG_KEY =
	process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ||
	process.env.POSTHOG_KEY?.trim() ||
	"";

export const POSTHOG_HOST =
	process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ||
	process.env.POSTHOG_HOST?.trim() ||
	"";

export const POSTHOG_UI_HOST = POSTHOG_HOST;
