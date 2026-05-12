-- CreateEnum
CREATE TYPE "RenderQaKind" AS ENUM ('COMPOSITION', 'LIKENESS');

-- CreateEnum
CREATE TYPE "RenderQaStatus" AS ENUM ('PASS', 'WARNING', 'FAIL');

-- CreateEnum
CREATE TYPE "RenderQaRecommendation" AS ENUM ('APPROVE', 'RERENDER', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "RenderQaReport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "portraitSlotId" TEXT,
    "renderJobId" TEXT,
    "artifactId" TEXT,
    "kind" "RenderQaKind" NOT NULL,
    "status" "RenderQaStatus" NOT NULL,
    "recommendation" "RenderQaRecommendation" NOT NULL,
    "summary" TEXT NOT NULL,
    "issues" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderQaReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenderQaReport_orderId_kind_createdAt_idx" ON "RenderQaReport"("orderId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "RenderQaReport_portraitSlotId_kind_createdAt_idx" ON "RenderQaReport"("portraitSlotId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "RenderQaReport_renderJobId_idx" ON "RenderQaReport"("renderJobId");

-- CreateIndex
CREATE INDEX "RenderQaReport_artifactId_idx" ON "RenderQaReport"("artifactId");

-- AddForeignKey
ALTER TABLE "RenderQaReport" ADD CONSTRAINT "RenderQaReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderQaReport" ADD CONSTRAINT "RenderQaReport_portraitSlotId_fkey" FOREIGN KEY ("portraitSlotId") REFERENCES "OrderPortraitSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderQaReport" ADD CONSTRAINT "RenderQaReport_renderJobId_fkey" FOREIGN KEY ("renderJobId") REFERENCES "RenderJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderQaReport" ADD CONSTRAINT "RenderQaReport_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
