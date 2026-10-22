-- Enrichment records no longer name a provider. New rows default to the
-- neutral source label; existing rows keep what they stored.

ALTER TABLE "companyEnrichment" ALTER COLUMN "source" SET DEFAULT 'company-enrichment';
