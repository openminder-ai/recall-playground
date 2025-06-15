#!/usr/bin/env python3
"""
Comprehensive server fix that handles ALL transformations.
Browser can stay mostly unchanged (OpenAI-compatible).
"""
import asyncio, json, logging, os, httpx
from websockets.legacy.server import serve, WebSocketServerProtocol
from websockets.legacy.client import connect
from dotenv import load_dotenv

load_dotenv()
PORT               = int(os.getenv("PORT", 8000))
AGENT_ID           = os.getenv("ELEVENLABS_AGENT_ID")
AGENT_PRIVATE      = os.getenv("AGENT_PRIVATE", "false").lower() == "true"
ELEVEN_API_KEY     = os.getenv("ELEVENLABS_API_KEY")

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("relay")

if not AGENT_ID:
    raise ValueError("AGENT_ID missing in .env")

async def connect_eleven():
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
        url = f"wss://api.elevenlabs.io/v1/convai/conversation?agent_id={AGENT_ID}"
    ws = await connect(url, subprotocols=["convai"])
    log.info("⇅ ElevenLabs socket open")
    return ws

def transform_eleven_to_browser(message_str):
    """Transform ElevenLabs messages to OpenAI-compatible format for browser"""
    try:
        msg = json.loads(message_str)
        msg_type = msg.get("type", "unknown")
        log.info(f"📨 ElevenLabs → Browser: {msg_type}")
        
        # ElevenLabs audio → OpenAI audio format
        if msg_type == "audio" and "audio_event" in msg:
            audio_base64 = msg["audio_event"].get("audio_base_64")
            if audio_base64:
                return json.dumps({
                    "type": "audio",
                    "audio_event": {
                        "audio_base_64": audio_base64
                    }
                })
        
        # ElevenLabs agent response → OpenAI agent response
        elif msg_type == "agent_response" and "agent_response_event" in msg:
            agent_response = msg["agent_response_event"].get("agent_response", "")
            return json.dumps({
                "type": "agent_response", 
                "agent_response_event": {
                    "agent_response": agent_response
                }
            })
        
        # ElevenLabs ping → OpenAI ping (store event_id for later pong fix)
        elif msg_type == "ping" and "ping_event" in msg:
            event_id = msg["ping_event"].get("event_id")
            # Store the real event_id but send something browser-compatible
            return json.dumps({
                "type": "ping",
                "ping_event": {
                    "event_id": event_id  # Send real integer to browser
                }
            })
        
        # ElevenLabs conversation init → OpenAI conversation init
        elif msg_type == "conversation_initiation_metadata":
            return json.dumps({
                "type": "conversation_initiation_metadata",
                "conversation_initiation_metadata_event": msg.get("conversation_initiation_metadata_event", {})
            })
        
        # Handle interruption
        elif msg_type == "interruption":
            return json.dumps({"type": "interruption"})
        
        # Pass through other messages
        else:
            log.info(f"🔄 Passthrough: {msg_type}")
            return message_str
        
    except Exception as e:
        log.error(f"❌ Error transforming ElevenLabs message: {e}")
        return message_str

def transform_browser_to_eleven(message_str, stored_ping_id=None):
    """Transform browser messages to ElevenLabs format"""
    try:
        msg = json.loads(message_str)
        msg_type = msg.get("type", "unknown")
        log.info(f"📤 Browser → ElevenLabs: {msg_type}")
        
        # Browser init → ElevenLabs init
        if msg_type == "conversation_initiation_client_data":
            return message_str  # Pass through
            
        # Browser audio chunk → ElevenLabs audio chunk
        elif "user_audio_chunk" in msg:
            audio_chunk = msg.get("user_audio_chunk", "")
            log.info(f"   📤 Audio chunk size: {len(audio_chunk)} chars")
            return message_str  # Pass through
            
        # Browser pong → ElevenLabs pong (FIX THE EVENT_ID!)
        elif msg_type == "pong":
            event_id = msg.get("event_id")
            
            # Handle different browser pong formats
            if isinstance(event_id, str):
                # Browser might send "ping" string instead of integer
                if event_id == "ping" and stored_ping_id is not None:
                    event_id = stored_ping_id  # Use stored real event_id
                else:
                    try:
                        event_id = int(event_id)  # Try to convert
                    except ValueError:
                        log.error(f"❌ Cannot convert event_id '{event_id}' to integer")
                        return message_str
            
            # Ensure event_id is integer for ElevenLabs
            if not isinstance(event_id, int):
                log.error(f"❌ event_id must be integer, got: {type(event_id)}")
                return message_str
            
            return json.dumps({
                "type": "pong",
                "event_id": event_id  # Must be integer
            })
        
        # Pass through other messages
        else:
            return message_str
        
    except Exception as e:
        log.error(f"❌ Error transforming browser message: {e}")
        return message_str

class Relay:
    def __init__(self):
        self.last_ping_event_id = None  # Store ping event_id for pong fixing
    
    async def handler(self, browser: WebSocketServerProtocol, _path: str):
        log.info("⇄ Browser connected")
        try:
            lab_ws = await connect_eleven()

            async def pump_to_eleven(browser, lab_ws):
                """Browser → ElevenLabs with transformation"""
                while True:
                    msg = await browser.recv()
                    transformed = transform_browser_to_eleven(msg, self.last_ping_event_id)
                    await lab_ws.send(transformed)

            async def pump_to_browser(lab_ws, browser):
                """ElevenLabs → Browser with transformation"""
                while True:
                    msg = await lab_ws.recv()
                    
                    # Store ping event_id for later pong correction
                    try:
                        parsed = json.loads(msg)
                        if parsed.get("type") == "ping" and "ping_event" in parsed:
                            self.last_ping_event_id = parsed["ping_event"].get("event_id")
                            log.info(f"🏓 Stored ping event_id: {self.last_ping_event_id}")
                    except:
                        pass
                    
                    transformed = transform_eleven_to_browser(msg)
                    await browser.send(transformed)

            await asyncio.gather(
                pump_to_eleven(browser, lab_ws),
                pump_to_browser(lab_ws, browser),
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