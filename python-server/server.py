#!/usr/bin/env python3
"""
WebSocket relay that hides your ElevenLabs API key from the browser.
"""
import asyncio, json, logging, os, httpx
from websockets.legacy.server import serve, WebSocketServerProtocol
from websockets.legacy.client import connect
from dotenv import load_dotenv

load_dotenv()
PORT               = int(os.getenv("PORT", 8000))
AGENT_ID           = os.getenv("ELEVENLABS_AGENT_ID")          # ← required
AGENT_PRIVATE      = os.getenv("AGENT_PRIVATE", "false").lower() == "true"
ELEVEN_API_KEY     = os.getenv("ELEVENLABS_API_KEY")  # only for private

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("relay")

if not AGENT_ID:
    raise ValueError("AGENT_ID missing in .env")

async def connect_eleven() -> "websockets.client":
    """Return an open WS to ElevenLabs Conv-AI."""
    if AGENT_PRIVATE:
        async with httpx.AsyncClient() as cli:
            r = await cli.get(
                "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
                params={"agent_id": AGENT_ID},
                headers={"xi-api-key": ELEVEN_API_KEY},
                timeout=10,
            )
            r.raise_for_status()
            url = r.json()["signed_url"]
    else:
        url = f"wss://api.elevenlabs.io/v1/convai/conversation?agent_id={AGENT_ID}"  # :contentReference[oaicite:0]{index=0}
    ws = await connect(url, subprotocols=["convai"])
    log.info("⇅ ElevenLabs socket open")
    return ws

class Relay:
    async def handler(self, browser: WebSocketServerProtocol, _path: str):
        log.info("⇄ Browser connected")
        try:
            lab_ws = await connect_eleven()

            async def pump(src, dst):
                while True:
                    msg = await src.recv()
                    await dst.send(msg)

            await asyncio.gather(
                pump(browser, lab_ws),  # user → lab
                pump(lab_ws, browser),  # lab → user
            )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.error("relay error: %s", e)
        finally:
            for sock in (browser, locals().get("lab_ws")):
                if sock and not sock.closed:
                    await sock.close()
            log.info("⇄ Connection closed")

    async def serve(self):
        async with serve(
            self.handler,
            "0.0.0.0",
            PORT,
            ping_interval=20,
            ping_timeout=20,
            subprotocols=["convai"],
        ):
            log.info("Relay running on :%d", PORT)
            await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(Relay().serve())
