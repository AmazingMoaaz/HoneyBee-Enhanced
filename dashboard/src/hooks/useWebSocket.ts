import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/auth";
import { apiWsUrl } from "../lib/apiBase";

interface Msg {
  type: string;
  topic?: string;
  timestamp?: string;
  payload?: any;
}

export function useWebSocket(topics: string[] = []) {
  const token = useAuthStore((s) => s.accessToken);
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<Msg | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(apiWsUrl("/ws", { token }));
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      topics.forEach((t) => ws.send(JSON.stringify({ type: "subscribe", topic: t })));
    };
    ws.onmessage = (ev) => {
      try {
        setLastMessage(JSON.parse(ev.data));
      } catch {}
    };
    ws.onclose = () => setConnected(false);
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, topics.join(",")]);

  const send = (m: any) => wsRef.current?.send(JSON.stringify(m));

  return { connected, lastMessage, send };
}
