// Test-process env, applied before any spec imports the modules that snapshot it.
const fallback = (key: string, value: string) => {
	if (!process.env[key]) process.env[key] = value;
};

fallback(
	"DATABASE_URL",
	"postgresql://postgres:postgres@localhost:54329/crm?schema=public",
);
fallback(
	"TEST_DATABASE_URL",
	"postgresql://postgres:postgres@localhost:54329/crm_test?schema=public",
);
fallback("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
fallback("API_URL", "http://localhost:3001");
fallback("ALLOWED_SIGN_IN", "example.com");
fallback("GOOGLE_CLIENT_ID", "test-google-client-id");
// A real key from the developer's .env must never reach the platform from a
// test (the lazy managed-signin provision would call it). The fake switch
// makes every client answer offline; capability-level tests inject fakes.
fallback("PRAMAAN_FAKE", "1");
