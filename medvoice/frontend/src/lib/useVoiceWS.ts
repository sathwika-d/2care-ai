import { useRef, useState, useCallback } from "react";

export type WsMessage =
  | { type: "session.created"; session_id: string; language: string }
  | { type: "response.text"; text: string; language: string; tool_calls: any[]; reasoning_trace: any[]; latency: { total_ms: number; breakdown: Record<string, number>; under_target: boolean }; trace_id: string }
  | { type: "processing.start"; trace_id: string }
  | { type: "error"; message: string }
  | { type: "session.ended" };

type Handlers = {
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export function useVoiceWebSocket(handlers: Handlers) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
    const ws = new WebSocket(`${wsUrl}/ws/voice`);

    ws.onopen = () => {
      setConnected(true);
      handlers.onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        handlers.onMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      handlers.onClose?.();
    };

    wsRef.current = ws;
  }, []);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  const initSession = useCallback((patientId?: string, language: string = "en") => {
    send({ type: "session.init", patient_id: patientId, language });
  }, [send]);

  const sendText = useCallback((text: string, patientContext?: object) => {
    send({ type: "text.input", text, patient_context: patientContext || {} });
  }, [send]);

  const endSession = useCallback(() => {
    send({ type: "session.end" });
  }, [send]);

  return { connected, connect, disconnect, initSession, sendText, endSession };
}
