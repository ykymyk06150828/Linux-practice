/**
 * 研修向けの簡易ブロックリスト（詳細設計の方針に沿う）。
 * 実運用ではホワイトリスト化や拡張を検討する。
 */

const BLOCKED_SUBSTRINGS = [
  "sudo",
  "su ",
  "su\t",
  "doas",
  "mkfs",
  "dd if=/dev",
  "dd if=/dev/",
  ":/dev/",
  "chmod 777 /",
  "curl ",
  "wget ",
  "nc ",
  "netcat",
  "ssh ",
  "ssh\t",
  "docker ",
  "docker.sock",
  "iptables",
  "mount /dev",
  "mknod",
  "insmod",
  "modprobe",
];

const BLOCKED_PATTERNS: RegExp[] = [
  /:\(\)\s*\{\s*:\|:&\s*\};\s*:/, // fork bomb
];

export function isCommandBlocked(line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return false;
  for (const s of BLOCKED_SUBSTRINGS) {
    if (normalized.includes(s.trim().toLowerCase())) return true;
  }
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(line)) return true;
  }
  return false;
}
