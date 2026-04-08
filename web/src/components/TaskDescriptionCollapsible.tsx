"use client";

import { useEffect, useState } from "react";

type Props = {
  text: string;
  /** 折りたたみ時の最大高さ（tailwind 任意値可） */
  collapsedMaxClass?: string;
  className?: string;
};

/** 長文は高さを抑え、「全文を表示」で展開 */
export function TaskDescriptionCollapsible({
  text,
  collapsedMaxClass = "max-h-28",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [text]);

  const likelyLong =
    text.length > 160 || text.split("\n").length > 5;

  return (
    <div className={className}>
      <div
        className={
          open ? "" : `${collapsedMaxClass} overflow-hidden`
        }
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
          {text}
        </p>
      </div>
      {likelyLong ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-sm font-medium text-[var(--accent)] hover:underline"
        >
          {open ? "折りたたむ" : "全文を表示"}
        </button>
      ) : null}
    </div>
  );
}
