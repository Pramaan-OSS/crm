import { plainToInstance, Type } from "class-transformer";
import {
	IsEnum,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	Min,
	MinLength,
	validateSync,
} from "class-validator";

export enum NodeEnv {
	Development = "development",
	Production = "production",
	Test = "test",
}

export class EnvironmentVariables {
	@IsEnum(NodeEnv)
	NODE_ENV: NodeEnv = NodeEnv.Development;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	PORT = 3001;

	// Local default matches the database `./start` launches (docker compose,
	// published on host port 54329 so it never collides with a Postgres the
	// person already runs on 5432). Set DATABASE_URL only to use your own.
	@IsString()
	@MinLength(1)
	DATABASE_URL: string =
		"postgresql://postgres:postgres@localhost:54329/crm?schema=public";

	// Generated into .env by ./start on first run. When it is set it must be a
	// real secret; the start script guarantees one before the API boots.
	@IsOptional()
	@IsString()
	@MinLength(32, {
		message:
			"BETTER_AUTH_SECRET must be at least 32 characters. Run ./start to generate one, or: openssl rand -base64 32",
	})
	BETTER_AUTH_SECRET?: string;

	// Only consulted once a sign-in method (GOOGLE_CLIENT_ID, MICROSOFT_CLIENT_ID
	// or SSO) is configured: with no method configured nobody can sign in at all,
	// so a fresh clone must boot without it. When a method is on, the sign-in
	// page and the user-creation hook say what to set.
	@IsOptional()
	@IsString()
	ALLOWED_SIGN_IN?: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_TENANT_ID?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	API_URL?: string;

	@IsOptional()
	@IsString()
	APP_URL?: string;

	@IsOptional()
	@IsString()
	AUTH_COOKIE_DOMAIN?: string;

	@IsOptional()
	@IsString()
	REDIS_URL?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	CACHE_TTL_MS?: number;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "CRON_SECRET must be at least 16 characters.",
	})
	CRON_SECRET?: string;

	/** Built-in sync scheduler: "on" by default; "off" leaves sync to an outside cron. */
	@IsOptional()
	@IsIn(["on", "off"])
	SYNC_SCHEDULER?: string;

	// Optional so the CRM itself works without the platform: capability features
	// check pramaanKeySet()/the status route and say what is missing instead of
	// blocking the whole install at boot.
	@IsOptional()
	@IsString()
	PRAMAAN_API_KEY?: string;

	@IsOptional()
	@IsString()
	PRAMAAN_BASE_URL?: string;

	@IsOptional()
	@IsString()
	PRAMAAN_STORAGE_BUCKET?: string;

	@IsOptional()
	@IsUrl(
		{ require_tld: false, require_protocol: true },
		{
			message:
				"AGENT_URL must be a full URL with a scheme, like http://127.0.0.1:2000.",
		},
	)
	AGENT_URL?: string;

	@IsOptional()
	@IsString()
	AGENT_BRIDGE_SECRET?: string;
}

export type RawEnvironment = Record<string, string | undefined>;

export function validateEnv(config: RawEnvironment): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
		exposeDefaultValues: true,
	});

	const errors = validateSync(validated, {
		skipMissingProperties: false,
		whitelist: false,
	});

	if (errors.length > 0) {
		const details = errors
			.map((error) => Object.values(error.constraints ?? {}).join(", "))
			.join("\n  - ");

		throw new Error(
			`Invalid environment configuration:\n  - ${details}\n\nSee .env.example at the root of the repo.`,
		);
	}

	return validated;
}
