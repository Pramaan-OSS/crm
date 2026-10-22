export {
	API_KEY_EXPIRATION,
	API_KEY_HEADER,
	API_KEY_PREFIX,
	DAY_SECONDS,
} from "./api-keys";
export {
	type Auth,
	auth,
	MANAGED_PROVIDER_ID,
	type Session,
	type SessionUser,
} from "./auth";
export { AUTH_COOKIE_PREFIX, SESSION_COOKIE_NAME } from "./cookies";
export {
	apiUrl,
	appUrl,
	isGoogleConfigured,
	isMicrosoftConfigured,
	trustedOrigins,
} from "./env";
export {
	ensureManagedBackend,
	type ManagedBackend,
	managedBackend,
	managedPramaan,
	managedReturnOrigins,
	resetManagedForTests,
	setManagedPramaanForTests,
} from "./managed";
export {
	canChangeRole,
	canManageConnections,
	canManageCurrency,
	canManageTracking,
	canRenameWorkspace,
	DEFAULT_WORKSPACE_NAME,
	ensureWorkspaceMembership,
	isWorkspaceAdmin,
	isWorkspaceRole,
	toWorkspaceRole,
	WORKSPACE_ID,
	WORKSPACE_ROLES,
	type WorkspaceRole,
	workspaceRoleOf,
} from "./organization";
export {
	CALENDAR_SCOPE,
	GMAIL_SCOPE,
	GOOGLE_PROVIDER_ID,
	hasSyncScopes,
	IDENTITY_SCOPES,
	isMailboxProvider,
	MAILBOX_PROVIDER_IDS,
	type MailboxProviderId,
	MICROSOFT_PROVIDER_ID,
	MICROSOFT_SYNC_SCOPES,
	mailboxGrantsNeeded,
	needsMailboxGrant,
	OUTLOOK_MAIL_SCOPE,
	parseScopes,
	REQUIRED_SCOPES,
	type SignInAccount,
	SYNC_SCOPES,
	SYNC_SCOPES_FOR,
	signsInOnlyWith,
	signsInWithGoogle,
	signsInWithMicrosoft,
} from "./scopes";
export { onSignedIn, type SignedInHandler } from "./signed-in";
export {
	canConfigureSso,
	ssoCallbackBase,
	ssoCallbackURL,
	ssoProviderName,
} from "./sso";
export {
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
	workspaceDomains,
} from "./workspace";
