/**
 * ログイン ID（メール形式）の表記ゆれを吸収する。
 * 同一人物の重複登録防止と、削除後の同一アドレス再登録を正しく扱う。
 */
export function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase();
}
