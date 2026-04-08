/** UTF-8 文字列を base64（ブラウザ） */
export function utf8ToBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

export function base64ToUtf8(b: string): string {
  return decodeURIComponent(escape(atob(b)));
}

export function getWsTerminalUrl(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:3001/ws/terminal";
  }
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  const { protocol, hostname } = window.location;
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${hostname}:3001/ws/terminal`;
}
