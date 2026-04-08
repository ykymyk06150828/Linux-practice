"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { base64ToUtf8, getWsTerminalUrl, utf8ToBase64 } from "@/lib/ws";

export type TerminalPaneHandle = {
  reconnect: () => void;
};

type Props = {
  onStatusChange?: (s: string) => void;
  /** 親が flex のとき高さを埋めてターミナルを最大化（演習の左右分割レイアウト用） */
  fill?: boolean;
  /** false のときターミナル直下の再接続ボタンを隠す（フッター等で再接続する場合） */
  showInlineReconnect?: boolean;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(
  function TerminalPane(
    { onStatusChange, fill, showInlineReconnect = true },
    ref,
  ) {
  const el = useRef<HTMLDivElement>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const [lineStatus, setLineStatus] = useState("接続準備中…");
  const [sessionKey, setSessionKey] = useState(0);
  /** 初回接続のみ自動再試行するためのカウンタ（手動「再接続」でリセット） */
  const wsAutoRetryRef = useRef(0);

  const runReconnectRef = useRef<() => void>(() => {});
  runReconnectRef.current = () => {
    wsAutoRetryRef.current = 0;
    setLineStatus("再接続中…");
    onStatusChangeRef.current?.("再接続中…");
    setSessionKey((k) => k + 1);
  };

  useImperativeHandle(
    ref,
    () => ({
      reconnect: () => runReconnectRef.current(),
    }),
    [],
  );

  useEffect(() => {
    const container = el.current;
    if (!container) return;

    let active = true;
    let opened = false;

    const term = new Terminal({
      // open 直後・fit 前に 0 列になると描画が欠けることがあるため既定サイズを持たせる
      cols: 80,
      rows: 24,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 14,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    /** FitAddon はコンテナが 0×0 やレンダラ未初期化のとき dimensions で落ちるためガードする */
    const safeFit = () => {
      if (!active) return;
      try {
        if (container.clientWidth < 2 || container.clientHeight < 2) return;
        fit.fit();
      } catch {
        /* ignore */
      }
    };

    const ws = new WebSocket(getWsTerminalUrl());

    const sendResize = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const cols = Math.max(term.cols || 80, 2);
      const rows = Math.max(term.rows || 24, 2);
      ws.send(
        JSON.stringify({
          type: "terminal.resize",
          cols,
          rows,
        }),
      );
    };

    ws.onopen = () => {
      if (!active) return;
      opened = true;
      wsAutoRetryRef.current = 0;
      setLineStatus("接続済み");
      onStatusChangeRef.current?.("接続済み");
      safeFit();
      sendResize();
      term.focus();
      // レイアウト確定後に再度 resize（シェルのプロンプト再描画を促す）
      requestAnimationFrame(() => {
        safeFit();
        sendResize();
      });
      setTimeout(() => {
        safeFit();
        sendResize();
      }, 150);
      setTimeout(() => {
        safeFit();
        sendResize();
      }, 400);
      setTimeout(() => {
        safeFit();
        sendResize();
      }, 900);
    };

    ws.onmessage = (ev) => {
      if (!active) return;
      const raw = typeof ev.data === "string" ? ev.data : "";
      try {
        const msg = JSON.parse(raw) as {
          type?: string;
          data?: string;
          message?: string;
          reason?: string;
        };
        if (msg.type === "terminal.output" && msg.data) {
          try {
            term.write(base64ToUtf8(msg.data));
          } catch {
            term.write("\r\n[表示エラー]\r\n");
          }
        }
        if (msg.type === "error" && msg.message) {
          term.write(`\r\n[エラー] ${msg.message}\r\n`);
        }
        if (msg.type === "session.disconnected") {
          term.write(`\r\n[切断] ${msg.reason ?? ""}\r\n`);
          setLineStatus("切断");
          onStatusChangeRef.current?.("切断");
        }
        if (msg.type === "session.idle_warning") {
          setLineStatus("無操作警告");
          onStatusChangeRef.current?.("無操作警告");
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      if (!active) return;
      setLineStatus("接続エラー");
      onStatusChangeRef.current?.("接続エラー");
    };

    ws.onclose = () => {
      if (!active) return;
      /** onopen 前に閉じた場合（バックエンド未起動・瞬断）のみ 1 回だけ自動再接続 */
      if (!opened && wsAutoRetryRef.current < 1) {
        wsAutoRetryRef.current += 1;
        setLineStatus("再接続試行中…");
        onStatusChangeRef.current?.("再接続試行中…");
        setTimeout(() => {
          if (active) setSessionKey((k) => k + 1);
        }, 600);
        return;
      }
      setLineStatus("切断");
      onStatusChangeRef.current?.("切断");
    };

    const sub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "terminal.input",
            data: utf8ToBase64(data),
          }),
        );
      }
    });

    const ro = new ResizeObserver(() => {
      safeFit();
      sendResize();
    });
    ro.observe(container);

    // 初回レイアウト後に fit（open 直後は dimensions 未確定のことがある）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        safeFit();
      });
    });

    return () => {
      active = false;
      ro.disconnect();
      sub.dispose();
      ws.close();
      term.dispose();
    };
  }, [sessionKey]);

  const canReconnect =
    lineStatus === "切断" || lineStatus === "接続エラー";

  return (
    <div
      className={`flex min-h-0 flex-col gap-2 ${fill ? "min-h-0 flex-1" : ""}`}
    >
      <div
        ref={el}
        className={`w-full overflow-hidden rounded-md border border-[var(--border)] bg-[#0d1117] ${
          fill
            ? "min-h-[100px] flex-1"
            : "min-h-[min(70vh,560px)]"
        }`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-[var(--muted)]">接続: {lineStatus}</p>
        {showInlineReconnect && canReconnect ? (
          <button
            type="button"
            onClick={() => runReconnectRef.current()}
            className="rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
          >
            再接続
          </button>
        ) : null}
      </div>
    </div>
  );
  },
);
