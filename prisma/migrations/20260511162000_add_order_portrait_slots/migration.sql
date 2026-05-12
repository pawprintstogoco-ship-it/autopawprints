CREATE TABLE "OrderPortraitSlot" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "slotNumber" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderPortraitSlot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CustomerUpload" ADD COLUMN "portraitSlotId" TEXT;
ALTER TABLE "RenderJob" ADD COLUMN "portraitSlotId" TEXT;
ALTER TABLE "Artifact" ADD COLUMN "portraitSlotId" TEXT;

CREATE UNIQUE INDEX "OrderPortraitSlot_orderId_slotNumber_key" ON "OrderPortraitSlot"("orderId", "slotNumber");
CREATE INDEX "OrderPortraitSlot_orderItemId_idx" ON "OrderPortraitSlot"("orderItemId");
CREATE UNIQUE INDEX "CustomerUpload_portraitSlotId_key" ON "CustomerUpload"("portraitSlotId");
CREATE INDEX "CustomerUpload_orderId_idx" ON "CustomerUpload"("orderId");
CREATE INDEX "RenderJob_portraitSlotId_idx" ON "RenderJob"("portraitSlotId");
CREATE INDEX "Artifact_portraitSlotId_idx" ON "Artifact"("portraitSlotId");

ALTER TABLE "OrderPortraitSlot" ADD CONSTRAINT "OrderPortraitSlot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderPortraitSlot" ADD CONSTRAINT "OrderPortraitSlot_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerUpload" ADD CONSTRAINT "CustomerUpload_portraitSlotId_fkey" FOREIGN KEY ("portraitSlotId") REFERENCES "OrderPortraitSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_portraitSlotId_fkey" FOREIGN KEY ("portraitSlotId") REFERENCES "OrderPortraitSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_portraitSlotId_fkey" FOREIGN KEY ("portraitSlotId") REFERENCES "OrderPortraitSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "OrderPortraitSlot" ("id", "orderId", "orderItemId", "slotNumber", "createdAt", "updatedAt")
SELECT
  concat('slot_', md5(o."id" || ':' || slot_numbers."slotNumber"::text)),
  o."id",
  NULL,
  slot_numbers."slotNumber",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Order" o
JOIN LATERAL generate_series(
  1,
  GREATEST(
    1,
    COALESCE(
      (
        SELECT SUM(GREATEST(1, oi."quantity"))
        FROM "OrderItem" oi
        WHERE oi."orderId" = o."id"
      ),
      1
    )
  )
) AS slot_numbers("slotNumber") ON TRUE
ON CONFLICT ("orderId", "slotNumber") DO NOTHING;

WITH first_uploads AS (
  SELECT DISTINCT ON ("orderId") "id", "orderId"
  FROM "CustomerUpload"
  WHERE "portraitSlotId" IS NULL
  ORDER BY "orderId", "createdAt" ASC
),
first_slots AS (
  SELECT "id", "orderId"
  FROM "OrderPortraitSlot"
  WHERE "slotNumber" = 1
)
UPDATE "CustomerUpload" cu
SET "portraitSlotId" = fs."id"
FROM first_uploads fu
JOIN first_slots fs ON fs."orderId" = fu."orderId"
WHERE cu."id" = fu."id";

UPDATE "RenderJob" rj
SET "portraitSlotId" = cu."portraitSlotId"
FROM "CustomerUpload" cu
WHERE rj."customerUploadId" = cu."id"
  AND rj."portraitSlotId" IS NULL
  AND cu."portraitSlotId" IS NOT NULL;

UPDATE "Artifact" a
SET "portraitSlotId" = rj."portraitSlotId"
FROM "RenderJob" rj
WHERE a."renderJobId" = rj."id"
  AND a."portraitSlotId" IS NULL
  AND rj."portraitSlotId" IS NOT NULL;
