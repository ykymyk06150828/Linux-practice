-- 受講者ターミナル用の許可コマンド（ホワイトリスト）。0 件のときは従来どおりブロックリストのみ適用。
CREATE TABLE "allowed_terminal_commands" (
    "id" UUID NOT NULL,
    "command_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_terminal_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "allowed_terminal_commands_command_name_key" ON "allowed_terminal_commands"("command_name");
