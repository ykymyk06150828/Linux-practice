import { redirect } from "next/navigation";

/** 一覧のモーダルへ誘導（旧 URL 互換） */
export default function AdminUserRegisterRedirectPage() {
  redirect("/admin/users?new=1");
}
