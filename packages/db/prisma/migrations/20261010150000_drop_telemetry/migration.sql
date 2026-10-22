-- Product analytics left the template: no third-party telemetry, no install IDs.
-- The staging tables for the removed pipeline go with it.

DROP TABLE IF EXISTS "telemetryCounter";
DROP TABLE IF EXISTS "telemetryMilestone";
DROP TABLE IF EXISTS "install";
