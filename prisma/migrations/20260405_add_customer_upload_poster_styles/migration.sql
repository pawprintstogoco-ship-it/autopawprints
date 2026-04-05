-- CreateEnum
CREATE TYPE "PosterFontStyle" AS ENUM ('SITE', 'SCRIPT');

-- CreateEnum
CREATE TYPE "PosterBackgroundStyle" AS ENUM ('OFF_WHITE', 'SAGE', 'SKY', 'SLATE', 'BEIGE', 'PINK');

-- AlterTable
ALTER TABLE "CustomerUpload"
ADD COLUMN "fontStyle" "PosterFontStyle" NOT NULL DEFAULT 'SITE',
ADD COLUMN "backgroundStyle" "PosterBackgroundStyle" NOT NULL DEFAULT 'OFF_WHITE';
