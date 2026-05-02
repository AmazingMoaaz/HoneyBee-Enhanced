import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/auth";

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
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/v1/ws?token=${token}`);
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
