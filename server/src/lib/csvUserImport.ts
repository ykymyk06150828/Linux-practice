import { parse } from "csv-parse/sync";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeLoginId } from "./loginId.js";

export type ImportRowError = { row: number; message: string };

const emailSchema = z.string().trim().email();
const uuidSchema = z.string().uuid();

/** 前後空白・{ } を除去し、DB 照合用に小文字化する */
function normalizeUuidToken(s: string): string {
  return s.trim().replace(/^\{|\}$/g, "").toLowerCase();
}

function isUuidToken(token: string): boolean {
  return uuidSchema.safeParse(token).success;
}

function looksLikeEmail(s: string): boolean {
  return emailSchema.safeParse(s).success;
}

export type HeaderIndex = {
  login: number;
  userName: number;
  password: number;
  role: number;
  courses: number;
};

/** 1行目がヘッダーかどうか（先頭セルがメール形式ならデータ行とみなす） */
export function csvHasHeaderRow(firstRow: string[]): boolean {
  const first = firstRow[0]?.trim() ?? "";
  if (!first) return true;
  return !looksLikeEmail(first);
}

export function resolveHeaderIndices(headerRow: string[]): HeaderIndex | null {
  const cells = headerRow.map((c) => c.trim());
  const find = (pred: (h: string) => boolean): number =>
    cells.findIndex((h) => pred(h));

  const login = find((h) =>
    /login|email|メール|ユーザid|ユーザ\s*id/i.test(h),
  );
  const userName = find((h) => {
    if (h === "名前" || h === "表示名") return true;
    return /^user_name$/i.test(h) || /^name$/i.test(h);
  });
  const password = find((h) => /パスワード|password/i.test(h));
  const role = find((h) => /ロール|role/i.test(h));
  const courses = find((h) => /受講|course/i.test(h));

  if (
    login < 0 ||
    userName < 0 ||
    password < 0 ||
    role < 0 ||
    courses < 0
  ) {
    return null;
  }
  const idx = new Set([login, userName, password, role, courses]);
  if (idx.size !== 5) {
    return null;
  }
  return { login, userName, password, role, courses };
}

export function parseCsvGrid(csvText: string): string[][] {
  return parse(csvText, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as string[][];
}

function normalizeRole(s: string): "learner" | "admin" | null {
  const r = s.trim().toLowerCase();
  if (
    r === "learner" ||
    r === "受講者" ||
    r === "student" ||
    r === "l"
  ) {
    return "learner";
  }
  if (r === "admin" || r === "管理者" || r === "a") {
    return "admin";
  }
  return null;
}

export type ValidatedCsvRow = {
  row: number;
  login_id: string;
  user_name: string;
  password: string;
  role: "learner" | "admin";
  coursesRaw: string;
};

const loginIdSchema = z.string().trim().min(1).max(64);
const userNameSchema = z.string().trim().min(1).max(200);
const passwordSchema = z.string().min(8).max(128);

/** データ行を検証（コース ID 解決前） */
export function validateDataRow(
  row: string[],
  rowNumber: number,
  indices: HeaderIndex | null,
): { ok: true; data: ValidatedCsvRow } | { ok: false; error: string } {
  const get = (i: number) => (row[i] ?? "").trim();
  let login_id: string;
  let user_name: string;
  let password: string;
  let roleRaw: string;
  let coursesRaw: string;

  if (indices) {
    login_id = get(indices.login);
    user_name = get(indices.userName);
    password = (row[indices.password] ?? "").trim();
    roleRaw = get(indices.role);
    /** 受講コース内のカンマで列が増えた場合、受講コース列から行末までを結合する */
    coursesRaw = row.slice(indices.courses).join(",").trim();
  } else {
    if (row.length < 5) {
      return {
        ok: false,
        error: `列が不足しています（5列必要、実際は ${row.length} 列）`,
      };
    }
    login_id = get(0);
    user_name = get(1);
    password = (row[2] ?? "").trim();
    roleRaw = get(3);
    /** 5列目以降をすべて受講コースとみなす（カンマ区切りのコース ID を引用なしで書いた場合） */
    coursesRaw = row.slice(4).join(",").trim();
  }

  const le = loginIdSchema.safeParse(login_id);
  if (!le.success) {
    return { ok: false, error: "ログイン ID は 1〜64 文字である必要があります" };
  }
  login_id = le.data;
  if (!emailSchema.safeParse(login_id).success) {
    return { ok: false, error: "ログイン ID は有効なメールアドレス形式である必要があります" };
  }
  login_id = normalizeLoginId(login_id);

  const un = userNameSchema.safeParse(user_name);
  if (!un.success) {
    return { ok: false, error: "名前は 1〜200 文字である必要があります" };
  }
  user_name = un.data;

  const pw = passwordSchema.safeParse(password);
  if (!pw.success) {
    return {
      ok: false,
      error: "パスワードは 8〜128 文字である必要があります",
    };
  }
  password = pw.data;

  const role = normalizeRole(roleRaw);
  if (!role) {
    return {
      ok: false,
      error:
        "ロールは learner / admin（または 受講者 / 管理者）のいずれかである必要があります",
    };
  }

  return {
    ok: true,
    data: {
      row: rowNumber,
      login_id,
      user_name,
      password,
      role,
      coursesRaw,
    },
  };
}

/** 複数コースは「/」区切り（推奨）。「/」が無い場合のみカンマ区切り（後方互換） */
function splitCourseTokens(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.includes("/")) {
    return t.split("/").map((s) => s.trim()).filter(Boolean);
  }
  return t.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * 受講コース列の各トークンを **コース ID（UUID）のみ** 解決し、無効なものはすべて errors に積む
 */
async function resolveCourseTokensToIds(
  prisma: PrismaClient,
  parts: string[],
): Promise<{ ids: string[]; errors: string[] }> {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const p of parts) {
    const token = normalizeUuidToken(p);
    if (!isUuidToken(token)) {
      errors.push(
        `受講コースは有効なコース ID（UUID）のみ指定できます。コース名は使用できません: ${p.trim()}`,
      );
      continue;
    }
    const c = await prisma.course.findUnique({
      where: { id: token },
    });
    if (!c || c.status !== "active") {
      errors.push(`コース ID が見つからないか有効ではありません: ${token}`);
      continue;
    }
    ids.push(c.id);
  }
  return { ids, errors };
}

type CourseResolveOk = { ok: true; ids: string[] };
type CourseResolveErr = { ok: false; messages: string[] };

async function resolveCourseIdsForRow(
  prisma: PrismaClient,
  coursesRaw: string,
  role: "learner" | "admin",
): Promise<CourseResolveOk | CourseResolveErr> {
  const parts = splitCourseTokens(coursesRaw);

  /** 管理者は受講登録しないが、列に値があるときは **すべてのトークンが有効なコースか** 検証する */
  if (role === "admin") {
    if (parts.length === 0) {
      return { ok: true, ids: [] };
    }
    const { errors } = await resolveCourseTokensToIds(prisma, parts);
    if (errors.length > 0) {
      return { ok: false, messages: errors };
    }
    return { ok: true, ids: [] };
  }

  if (parts.length === 0) {
    const firstActive = await prisma.course.findFirst({
      where: { status: "active" },
      orderBy: { createdAt: "asc" },
    });
    if (!firstActive) {
      return {
        ok: false,
        messages: [
          "受講コースが空で、有効なコースがシステムに存在しません。コースを登録するか、CSV でコース ID（UUID）を指定してください。",
        ],
      };
    }
    return { ok: true, ids: [firstActive.id] };
  }

  const { ids, errors } = await resolveCourseTokensToIds(prisma, parts);
  if (errors.length > 0) {
    return { ok: false, messages: errors };
  }
  return { ok: true, ids: [...new Set(ids)] };
}

export type UserImportResult =
  | {
      ok: true;
      created: number;
      users: { id: string; login_id: string; user_name: string; role: string }[];
    }
  | { ok: false; errors: ImportRowError[] };

const MAX_ROWS = 500;

export type ImportUsersFromCsvOptions = {
  /** 監査ログ用（ユーザー作成と同一トランザクションで記録する） */
  adminUserId: string;
};

async function finalizeUserImportAfterValidation(
  prisma: PrismaClient,
  validated: ValidatedCsvRow[],
  seenLogins: Set<string>,
  hashPassword: (plain: string) => Promise<string>,
  options: ImportUsersFromCsvOptions,
): Promise<UserImportResult> {
  const errors: ImportRowError[] = [];
  const existing = await prisma.user.findMany({
    where: {
      OR: [...seenLogins].map((loginId) => ({
        loginId: { equals: loginId, mode: "insensitive" as const },
      })),
    },
    select: { loginId: true },
  });
  if (existing.length > 0) {
    for (const e of existing) {
      errors.push({
        row: 0,
        message: `既に登録されているログイン ID です: ${e.loginId}`,
      });
    }
    return { ok: false, errors };
  }

  const courseIdsByRow = new Map<number, string[]>();
  for (const vr of validated) {
    const res = await resolveCourseIdsForRow(
      prisma,
      vr.coursesRaw,
      vr.role,
    );
    if (!res.ok) {
      for (const m of res.messages) {
        errors.push({ row: vr.row, message: m });
      }
    } else {
      courseIdsByRow.set(vr.row, res.ids);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const hashedPasswords = await Promise.all(
    validated.map((vr) => hashPassword(vr.password)),
  );

  const createdUsers: {
    id: string;
    login_id: string;
    user_name: string;
    role: string;
  }[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < validated.length; i++) {
          const vr = validated[i];
          const courseIds = courseIdsByRow.get(vr.row) ?? [];
          const passwordHash = hashedPasswords[i];
          const user = await tx.user.create({
            data: {
              loginId: vr.login_id,
              userName: vr.user_name,
              passwordHash,
              role: vr.role,
              status: "active",
            },
          });
          if (vr.role === "learner" && courseIds.length > 0) {
            const uniqueCourseIds = [...new Set(courseIds)];
            await tx.userCourseEnrollment.createMany({
              data: uniqueCourseIds.map((courseId) => ({
                userId: user.id,
                courseId,
              })),
            });
          }
          createdUsers.push({
            id: user.id,
            login_id: user.loginId,
            user_name: user.userName,
            role: user.role,
          });
        }
        await tx.adminAuditLog.create({
          data: {
            adminUserId: options.adminUserId,
            actionType: "user.import",
            actionResult: "ok",
            detail: {
              count: createdUsers.length,
              login_ids: createdUsers.map((u) => u.login_id),
            },
          },
        });
      },
      { timeout: 60_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const meta = e.meta as {
        modelName?: string;
        target?: string[] | string;
        constraint?: string;
      };
      const model = meta?.modelName ?? "";
      const targetArr = Array.isArray(meta?.target)
        ? meta.target
        : meta?.target != null
          ? [String(meta.target)]
          : [];
      const constraintLc = String(meta?.constraint ?? "").toLowerCase();
      const blob = [
        model,
        ...targetArr,
        meta?.constraint ?? "",
      ]
        .join(" ")
        .toLowerCase();

      const isLegacySingleEnrollmentPerUser =
        constraintLc === "user_course_enrollments_user_id_key" ||
        /\buser_course_enrollments_user_id_key\b/.test(blob) ||
        (constraintLc.startsWith("user_course_enrollments") &&
          constraintLc.endsWith("_user_id_key") &&
          !constraintLc.includes("course_id"));

      if (isLegacySingleEnrollmentPerUser) {
        return {
          ok: false,
          errors: [
            {
              row: 0,
              message:
                "データベースが複数コースの受講登録に対応していません（古い一意制約が残っています）。サーバーで `npx prisma migrate deploy` を実行してマイグレーションを適用してください。開発環境では `npx prisma migrate dev` でも構いません。",
            },
          ],
        };
      }

      const isLoginUnique =
        model === "User" ||
        /\blogin_id\b|users_login|@unique.*login/i.test(blob);
      const isCompositeEnrollmentDuplicate =
        model === "UserCourseEnrollment" ||
        constraintLc.includes("user_id_course_id") ||
        /\buser_course_enrollments_user_id_course_id/i.test(blob);
      if (isLoginUnique && !isCompositeEnrollmentDuplicate) {
        return {
          ok: false,
          errors: [
            {
              row: 0,
              message:
                "ログイン ID が既に登録されています（メールアドレスの大文字・小文字の違いは同一とみなします）。ユーザー一覧で該当ユーザーを削除できているか、または取り込みデータ内の別行と重複していないか確認してください。",
            },
          ],
        };
      }
      if (isCompositeEnrollmentDuplicate) {
        return {
          ok: false,
          errors: [
            {
              row: 0,
              message:
                "受講コースの紐付けが重複しています。同一ユーザーに同じコースを二重に指定していないか確認してください。",
            },
          ],
        };
      }
      return {
        ok: false,
        errors: [
          {
            row: 0,
            message:
              "一意制約に抵触しました。データを更新してから再度お試しください。",
          },
        ],
      };
    }
    throw e;
  }

  return { ok: true, created: createdUsers.length, users: createdUsers };
}

/**
 * CSV 全体を検証し、問題なければユーザーを一括作成する（途中失敗時はロールバックしない — 事前に全検証）
 */
export async function importUsersFromCsv(
  prisma: PrismaClient,
  csvText: string,
  hashPassword: (plain: string) => Promise<string>,
  options: ImportUsersFromCsvOptions,
): Promise<UserImportResult> {
  const errors: ImportRowError[] = [];
  if (!csvText || !csvText.trim()) {
    return { ok: false, errors: [{ row: 0, message: "CSV が空です" }] };
  }

  let grid: string[][];
  try {
    grid = parseCsvGrid(csvText);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          row: 0,
          message: `CSV の解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
    };
  }

  if (grid.length === 0) {
    return { ok: false, errors: [{ row: 0, message: "データ行がありません" }] };
  }

  let dataRows: string[][];
  let headerIdx: HeaderIndex | null = null;
  const first = grid[0] ?? [];

  if (csvHasHeaderRow(first)) {
    headerIdx = resolveHeaderIndices(first);
    if (!headerIdx) {
      return {
        ok: false,
        errors: [
          {
            row: 1,
            message:
              "ヘッダー行を解釈できませんでした。列名に「ユーザID・メール」「名前」「パスワード」「ロール」「受講コース」が含まれるか確認してください。",
          },
        ],
      };
    }
    dataRows = grid.slice(1);
  } else {
    dataRows = grid;
  }

  if (dataRows.length > MAX_ROWS) {
    return {
      ok: false,
      errors: [
        {
          row: 0,
          message: `一度にインポートできるのは ${MAX_ROWS} 件までです（現在 ${dataRows.length} 件）`,
        },
      ],
    };
  }

  const validated: ValidatedCsvRow[] = [];
  const seenLogins = new Set<string>();

  let displayRow = headerIdx ? 2 : 1;
  for (const row of dataRows) {
    if (row.every((c) => !String(c).trim())) {
      displayRow++;
      continue;
    }
    const v = validateDataRow(row, displayRow, headerIdx);
    if (!v.ok) {
      errors.push({ row: displayRow, message: v.error });
    } else {
      if (seenLogins.has(v.data.login_id)) {
        errors.push({
          row: displayRow,
          message: `ログイン ID が CSV 内で重複しています: ${v.data.login_id}`,
        });
      } else {
        seenLogins.add(v.data.login_id);
        validated.push(v.data);
      }
    }
    displayRow++;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (validated.length === 0) {
    return { ok: false, errors: [{ row: 0, message: "取り込むデータ行がありません" }] };
  }

  return finalizeUserImportAfterValidation(
    prisma,
    validated,
    seenLogins,
    hashPassword,
    options,
  );
}
