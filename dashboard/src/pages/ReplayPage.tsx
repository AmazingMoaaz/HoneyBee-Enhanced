import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import api from "../api/client";

interface Replay {
  session: any;
  chunks: { sequence: number; data_b64: string }[];
}

export default function ReplayPage() {
  const { id }    = useParams();
  const ref       = useRef<HTMLDivElement | null>(null);
  const termRef   = useRef<Terminal | null>(null);
  const [speed,   setSpeed]   = useState(100);
  const [playing, setPlaying] = useState(false);

  const { data } = useQuery<Replay>({
    queryKey: ["replay", id],
    queryFn: async () => (await api.get(`/sessions/${id}/replay`)).data,
  });

  useEffect(() => {
    if (!ref.current || termRef.current) return;
    const t = new Terminal({
      convertEol: true,
      theme: { background: "#1A0F05", foreground: "#FDE5AD", cursor: "#F7AB06", selectionBackground: "#F7AB0640" },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(ref.current);
    fit.fit();
    termRef.current = t;
  }, []);

  const play = async () => {
    if (!data || !termRef.current) return;
    setPlaying(true);
    termRef.current.clear();
    for (const c of data.chunks) {
      const bin = atob(c.data_b64);
      const u8  = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      termRef.current.write(u8);
      await new Promise((r) => setTimeout(r, speed));
    }
    setPlaying(false);
  };

  return (
    <div className="space-y-5 animate-fade-up">

      {/* Header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="page-label">Session replay</p>
            <h1 className="page-title">Session <span className="font-mono">#{id}</span></h1>
            {data?.session && (
              <div className="flex gap-3 mt-1 text-xs" style={{ color: "rgba(54,33,12,0.5)" }}>
                <span>From: <strong style={{ color: "#36210C" }}>{data.session.src_ip}:{data.session.src_port}</strong></span>
                <span>&middot; {data.chunks?.length ?? 0} chunks</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs" style={{ color: "rgba(54,33,12,0.6)" }}>
              delay&nbsp;<strong style={{ color: "#36210C" }}>{speed}&nbsp;ms</strong>
              <input
                type="range" min={1} max={500} value={speed}
                onChange={(e) => setSpeed(parseInt(e.target.value))}
                className="w-28 accent-honey-500"
              />
            </label>
            <button className="btn btn-primary" disabled={playing || !data} onClick={play}>
              {playing ? "Playing…" : "▶ Play"}
            </button>
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className="card overflow-hidden" style={{ background: "#1A0F05", borderColor: "rgba(247,171,6,0.2)" }}>
        <div ref={ref} className="h-[540px]" />
      </div>
    </div>
  );
}
