import { redirect } from "next/navigation";

/** 共通ログイン `/login` へ統一 */
export default function AdminLoginRedirectPage() {
  redirect("/login");
}
