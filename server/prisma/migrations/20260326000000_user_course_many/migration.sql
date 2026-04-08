-- 1ユーザー1コース制約をやめ、同一ユーザーに複数コースを紐付け可能にする
-- 新規 DB（init 適用済み）では複合一意が既にあるため冪等にする
ALTER TABLE "user_course_enrollments" DROP CONSTRAINT IF EXISTS "user_course_enrollments_user_id_key";

DROP INDEX IF EXISTS "user_course_enrollments_user_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "user_course_enrollments_user_id_course_id_key" ON "user_course_enrollments"("user_id", "course_id");
