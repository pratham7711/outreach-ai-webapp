-- viewsCount can exceed INT4 max (2,147,483,647) for high-view YouTube videos.
-- Widen to DOUBLE PRECISION (lossless for all realistic view counts, < 2^53).
ALTER TABLE "Post" ALTER COLUMN "viewsCount" SET DEFAULT 0,
ALTER COLUMN "viewsCount" SET DATA TYPE DOUBLE PRECISION;

ALTER TABLE "PostMetricSnapshot" ALTER COLUMN "viewsCount" SET DEFAULT 0,
ALTER COLUMN "viewsCount" SET DATA TYPE DOUBLE PRECISION;
