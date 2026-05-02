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
  const { id } = useParams();
  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [speed, setSpeed] = useState(100);
  const [playing, setPlaying] = useState(false);

  const { data } = useQuery<Replay>({
    queryKey: ["replay", id],
    queryFn: async () => (await api.get(`/sessions/${id}/replay`)).data,
  });

  useEffect(() => {
    if (!ref.current || termRef.current) return;
    const t = new Terminal({ convertEol: true, theme: { background: "#020617" } });
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
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      termRef.current.write(u8);
      await new Promise((r) => setTimeout(r, speed));
    }
    setPlaying(false);
  };

  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-bold">Session #{id} replay</h2>
      <div className="flex items-center gap-4">
        <button onClick={play} disabled={playing}
                className="bg-honey-500 text-slate-900 px-4 py-1.5 rounded font-semibold disabled:opacity-50">
          {playing ? "playing…" : "play"}
        </button>
        <label className="text-sm text-slate-400">
          delay (ms): {speed}
          <input type="range" min={1} max={500} value={speed}
                 onChange={(e) => setSpeed(parseInt(e.target.value))} className="ml-2 align-middle" />
        </label>
      </div>
      <div ref={ref} className="h-[480px] bg-slate-950 border border-slate-800 rounded-lg p-2"></div>
    </div>
  );
}
