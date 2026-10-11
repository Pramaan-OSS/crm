-- The template runs its outside calls through Pramaan, so the per-vendor
-- machinery goes: Slack integration tables, the per-workspace agent model
-- picker, and the vendor research key.

DROP TABLE IF EXISTS "slackChannel" CASCADE;
DROP TABLE IF EXISTS "slackInstallation" CASCADE;
DROP TABLE IF EXISTS "slackWorkspaceGrant" CASCADE;
DROP TABLE IF EXISTS "slackMemberMatch" CASCADE;

ALTER TABLE "agentVersion" DROP COLUMN IF EXISTS "modelId";
ALTER TABLE "agentVersion" DROP COLUMN IF EXISTS "modelContextWindowTokens";

ALTER TABLE "appSetting" DROP COLUMN IF EXISTS "agentModelId";
ALTER TABLE "appSetting" DROP COLUMN IF EXISTS "agentModelContextWindow";
ALTER TABLE "appSetting" DROP COLUMN IF EXISTS "contextDevApiKey";

-- Rate rows were fetched through a vendor feed; they now come from Pramaan.
UPDATE "exchangeRate" SET "provider" = 'pramaan' WHERE "source" = 'FETCHED';

-- Custom agents declared a Slack action; the action type no longer exists.
UPDATE "agentVersion"
SET "manifest" = jsonb_set(
    "manifest",
    '{actions}',
    (
        SELECT COALESCE(jsonb_agg(action), '[]'::jsonb)
        FROM jsonb_array_elements("manifest" -> 'actions') AS action
        WHERE action ->> 'type' <> 'slack.message.post'
    )
)
WHERE "manifest" -> 'actions' IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements("manifest" -> 'actions') AS action
      WHERE action ->> 'type' = 'slack.message.post'
  );
