import { isCommandBlocked } from "./command-blocklist.js";

export type LineBlockReason = "blocklist";

/**
 * ターミナルで 1 行入力が完了したときのポリシー（ブロックリストのみ）。
 */
export function getTerminalLineBlockInfo(line: string): {
  blocked: boolean;
  reason: LineBlockReason | null;
} {
  const trimmed = line.trim();
  if (!trimmed) {
    return { blocked: false, reason: null };
  }
  if (isCommandBlocked(line)) {
    return { blocked: true, reason: "blocklist" };
  }
  return { blocked: false, reason: null };
}
