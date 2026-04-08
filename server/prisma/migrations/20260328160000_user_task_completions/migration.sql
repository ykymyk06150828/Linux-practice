-- CreateTable
CREATE TABLE "user_task_completions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_task_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_task_completions_user_id_task_id_key" ON "user_task_completions"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "user_task_completions_user_id_idx" ON "user_task_completions"("user_id");

-- AddForeignKey
ALTER TABLE "user_task_completions" ADD CONSTRAINT "user_task_completions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_task_completions" ADD CONSTRAINT "user_task_completions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
