import { useState, useEffect, useRef, useCallback } from "react";
// ⬇ ONLY our own helpers now – no @openai/realtime-api-beta
import {
  WavRecorder,
  WavStreamPlayer,
  WavPacker,
} from "./lib/wavtools/index.js";
import "./App.css";

/* ---------- simple helpers ---------- */
function uint8ToB64(u8: Uint8Array) {
  return btoa(String.fromCharCode(...u8));
}

/* ---------- component ---------- */
export function App() {
  const qs                 = new URLSearchParams(window.location.search);
  const RELAY_URL          = qs.get("wss");             // ?wss=ws://relay:3000
  const [status, setStat]  = useState<"disconnected" | "connecting" | "connected">(
    "disconnected",
  );

  /* one-time singletons -------------------------------------------------- */
  const wsRef   = useRef<WebSocket | null>(null);
  const recRef  = useRef<WavRecorder  | null>(null);
  const playRef = useRef<WavStreamPlayer | null>(null);
  const started = useRef(false);

  if (!recRef.current)  recRef.current  = new WavRecorder({ sampleRate: 24000 });
  if (!playRef.current) playRef.current = new WavStreamPlayer({ sampleRate: 24000 });

  /* ---------------- main connect ---------------- */
  const connect = useCallback(async () => {
    if (started.current || !RELAY_URL) return;
    started.current = true;
    setStat("connecting");

    /* mic + speakers */
    await recRef.current!.begin();
    await playRef.current!.connect();

    /* WebSocket to OUR relay (the server will forward to ElevenLabs) */
    const ws                 = new WebSocket(RELAY_URL, "convai");
    wsRef.current            = ws;
    ws.binaryType            = "arraybuffer";

    /* handshake once socket is up */
    ws.addEventListener("open", () => {
      setStat("connected");
      ws.send(
        JSON.stringify({
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: { language: "en" },            // CHANGE fields as you like
            tts:  { voice_id: "21m00Tcm4TlvDq8ikWAM" },
          },
        }),
      );
    });

    ws.addEventListener("close", () => setStat("disconnected"));
    ws.addEventListener("error", () => setStat("disconnected"));

    /* ---------- incoming messages ---------- */
    ws.addEventListener("message", async (ev) => {
      const msg = JSON.parse(ev.data);
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
          console.debug("Unhandled", msg);
      }
    });

    /* ---------- outgoing mic stream ---------- */
    await recRef.current!.record(({ mono }) => {
      const pcm   = WavPacker.floatTo16BitPCM(mono);   // Uint8Array buffer
      const b64   = uint8ToB64(new Uint8Array(pcm));
      ws.send(JSON.stringify({ user_audio_chunk: b64 }));
    });
  }, [RELAY_URL]);

  /* kick things off on mount */
  useEffect(() => {
    if (RELAY_URL) connect();
  }, [RELAY_URL, connect]);

  /* ---------- tiny status UI ---------- */
  const err = !RELAY_URL ? 'Missing "?wss=" query param' : null;

  return (
    <div className="app-container">
      <div className="status-indicator">
        <div className={`status-dot ${err ? "disconnected" : status}`} />
        <div className="status-text">
          <div className="status-label">
            {err ? "Error:" :
             status === "connecting" ? "Connecting to:" :
             status === "connected"  ? "Connected to:"  : "Disconnected from:"}
          </div>
          <div className="status-url">{err || RELAY_URL}</div>
        </div>
      </div>
    </div>
  );
}

export default App;
