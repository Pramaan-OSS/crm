// A neutral injection token: importing the MailboxSyncService class directly
// would create a module cycle with the Google and Microsoft modules.
export const MAILBOX_SYNC = Symbol("MAILBOX_SYNC");

export type MailboxSyncRunner = {
	runDue(): Promise<{
		attempted: number;
		synced: number;
		skipped: number;
		rateLimited: number;
		failed: number;
		durationMs: number;
	}>;
	runForUser(userId: string): Promise<{
		attempted: number;
		synced: number;
		skipped: number;
		rateLimited: number;
		failed: number;
		durationMs: number;
	}>;
};
