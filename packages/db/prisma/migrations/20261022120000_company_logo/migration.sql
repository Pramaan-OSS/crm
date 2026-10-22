CREATE TABLE "companyLogo" (
  "companyId" TEXT NOT NULL PRIMARY KEY,
  "sourceFileId" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companyLogo_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "companyLogo_sourceFileId_idx" ON "companyLogo"("sourceFileId");
