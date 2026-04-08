-- 各コース内で表示順を 1 からの連番に正規化（1 始まり）
-- 実テーブル名は Prisma 既定の "Task"（tasks ではない）
WITH renumbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY course_id
      ORDER BY display_order ASC, created_at ASC
    ) AS rn
  FROM "Task"
)
UPDATE "Task" AS t
SET display_order = r.rn
FROM renumbered AS r
WHERE t.id = r.id;
