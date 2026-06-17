import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, Icons } from "./Icons";

export interface CommandItem {
  to: string;
  label: string;
  icon: string;
  group?: string;
}

/**
 * CommandPalette — a ⌘K / Ctrl+K quick-navigation overlay. Fully keyboard
 * driven (↑ ↓ to move, ↵ to open, esc to close) and rendered through a portal
 * so it floats above the whole app.
 */
export default function CommandPalette({
  items,
  onNavigate,
  onClose,
}: {
  items: CommandItem[];
  onNavigate: (to: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((i) => i.label.toLowerCase().includes(term) || (i.group ?? "").toLowerCase().includes(term));
  }, [items, q]);

  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const choose = (i: number) => {
    const item = filtered[i];
    if (item) { onNavigate(item.to); onClose(); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((v) => Math.min(v + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((v) => Math.max(v - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(idx); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4" style={{ paddingTop: "16vh" }}>
      <div className="absolute inset-0" style={{ background: "var(--overlay)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }} onClick={onClose} />
      <div className="card relative animate-fade-up w-full" style={{ maxWidth: 560, zIndex: 1, overflow: "hidden", padding: 0 }} onKeyDown={onKey}>
        {/* search row */}
        <div className="flex items-center gap-3 px-4" style={{ height: 56, borderBottom: "1px solid var(--border)" }}>
          <Icon d={Icons.search} size={18} color="var(--text-faint)" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: "var(--text)" }} />
          <kbd className="kbd">ESC</kbd>
        </div>

        {/* results */}
        <div ref={listRef} style={{ maxHeight: 360, overflowY: "auto", padding: 8 }}>
          {filtered.length === 0 ? (
            <div className="text-center" style={{ padding: "28px 0", color: "var(--text-faint)", fontSize: 13 }}>No matches for “{q}”.</div>
          ) : (
            filtered.map((item, i) => {
              const active = i === idx;
              return (
                <button key={item.to} data-i={i} onMouseEnter={() => setIdx(i)} onClick={() => choose(i)}
                  className="flex items-center gap-3 w-full text-left"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: active ? "rgba(245,158,11,0.12)" : "transparent" }}>
                  <span className="grid place-items-center shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: active ? "rgba(245,158,11,0.18)" : "var(--bg-2)", color: active ? "var(--accent)" : "var(--text-muted)" }}>
                    <Icon d={item.icon} size={16} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{item.label}</span>
                  {item.group && <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)" }}>{item.group}</span>}
                  {active && <Icon d={Icons.arrow} size={15} color="var(--accent)" />}
                </button>
              );
            })
          )}
        </div>

        {/* footer hint */}
        <div className="flex items-center gap-4 px-4" style={{ height: 38, borderTop: "1px solid var(--border)", background: "var(--bg-2)", color: "var(--text-faint)", fontSize: 11 }}>
          <span><b style={{ color: "var(--text-muted)" }}>↑↓</b> navigate</span>
          <span><b style={{ color: "var(--text-muted)" }}>↵</b> open</span>
          <span><b style={{ color: "var(--text-muted)" }}>esc</b> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
