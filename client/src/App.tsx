import { useState, useEffect, useRef, useCallback } from "react";
import { WavRecorder, WavStreamPlayer } from "./lib/wavtools/index.js";
import "./App.css";

/* helper -------------------------------------------------------------- */

/* component ----------------------------------------------------------- */
export function App() {
  const qs = new URLSearchParams(window.location.search);
  const RELAY_URL = qs.get("wss");           // e.g. ?wss=ws://localhost:8000
  const [state, setState] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  /* singletons -------------------------------------------------------- */
  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<WavRecorder | null>(null);
  const playRef = useRef<WavStreamPlayer | null>(null);
  const booted = useRef(false);

  if (!recRef.current) recRef.current = new WavRecorder({ sampleRate: 16000 });
  if (!playRef.current) playRef.current = new WavStreamPlayer({ sampleRate: 16000 });

  /* ------------------------------------------------------------------ */
  const connect = useCallback(async () => {
    if (booted.current || !RELAY_URL) return;
    booted.current = true;
    setState("connecting");

    /* 1️⃣  prime mic + speakers first --------------------------------- */
    await recRef.current!.begin();
    await playRef.current!.connect();

    /* 2️⃣  open socket to relay --------------------------------------- */
    const ws = new WebSocket(RELAY_URL, "convai");
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setState("connected");
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
    });

    /* 3️⃣  when INIT-META arrives, start streaming mic ---------------- */
    let started = false;

    ws.addEventListener("message", async (ev) => {
      const msg = JSON.parse(ev.data);

      /* 1️⃣  HANDSHAKE COMPLETE?  --------------------------------------- */
      const gotMeta =
        (!started &&
          (msg.type === "conversation_initiation_metadata" ||
            msg.conversation_initiation_metadata_event));
      if (gotMeta) {
        started = true;

        await recRef.current!.record(({ mono }) => {
          if (!mono || mono.byteLength === 0) return;           // empty chunk

          // quick silence test: every byte == 0?
          const u8 = new Uint8Array(mono);
          let nonZero = false;
          for (let i = 0; i < u8.length; i++) {
            if (u8[i] !== 0) { nonZero = true; break; }
          }
          if (!nonZero) return;                                 // silent frame

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                user_audio_chunk: btoa(String.fromCharCode(...u8)),
              }),
            );
          }
        });
        return; // meta message handled, nothing else to do
      }

      /* 2️⃣  NORMAL EVENT HANDLING -------------------------------------- */
      switch (msg.type) {
        case "audio":
          playRef.current!.addBase64Mp3(msg.audio_event.audio_base_64);
          break;
        case "agent_response":
          console.log("Agent:", msg.agent_response_event.agent_response);
          break;
        case "ping":
          ws.send(JSON.stringify({ type: "pong", event_id: msg.ping_event.event_id }));
          break;
        case "interruption":
          await playRef.current!.interrupt();
          break;
        default:
        // ignore everything else
      }
    });

    ws.addEventListener("close", () => setState("disconnected"));
    ws.addEventListener("error", () => setState("disconnected"));
  }, [RELAY_URL]);

  useEffect(() => { if (RELAY_URL) connect(); }, [RELAY_URL, connect]);

  /* simple status UI -------------------------------------------------- */
  const err = !RELAY_URL ? 'Missing "?wss=" param' : null;
  return (
    <div className="app-container">
      <div className="status-indicator">
        <div className={`status-dot ${err ? "disconnected" : state}`} />
        <div className="status-text">
          <div className="status-label">
            {err ? "Error:" :
              state === "connecting" ? "Connecting to:" :
                state === "connected" ? "Connected to:" : "Disconnected from:"}
          </div>
          <div className="status-url">{err || RELAY_URL}</div>
        </div>
      </div>
    </div>
  );
}

export default App;