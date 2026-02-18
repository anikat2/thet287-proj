from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import socket
import secrets
import random
import asyncio
import httpx
import base64
import os
from io import BytesIO
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

server = "10.174.48.65"
port = 5555
app = FastAPI()
active_servers = {}

HF_API_TOKEN = os.environ.get("HF_API_TOKEN", "")  # set this in your env
HF_MODEL_URL = "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-inpainting"

PROMPTS = [
    "a dragon eating ice cream",
    "an astronaut riding a bicycle",
    "a cat being the president",
    "a haunted library at midnight",
    "a robot learning to dance",
    "a mermaid in a coffee shop",
    "a wizard stuck in traffic",
    "a dinosaur at the gym",
    "a penguin surfing a tsunami",
    "a dog conducting an orchestra",
]

game_sessions = {}

origins = [
    "http://localhost:3000",
    "http://localhost:5173",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

s = None


def accept_connections_thread():
    global s
    while True:
        try:
            conn, addr = s.accept()
            print(f"Socket connection from {addr}")
        except Exception:
            break


async def run_inpainting(image_b64: str, prompt: str, complete_right: bool) -> str:
    """
    image_b64: base64 PNG of the full canvas (900x500)
    complete_right: True = mask right half (AI fills right), False = mask left half
    Returns base64 PNG of the AI completed image
    """
    try:
        # Build a black/white mask: white = area for AI to fill, black = keep
        from PIL import Image
        import numpy as np

        img_bytes = base64.b64decode(image_b64)
        img = Image.open(BytesIO(img_bytes)).convert("RGB")
        img = img.resize((512, 512))  # HF model requires 512x512

        # Create mask - white on the half AI should complete
        mask = Image.new("RGB", (512, 512), "black")
        mask_arr = np.array(mask)
        if complete_right:
            mask_arr[:, 256:] = 255  # right half white
        else:
            mask_arr[:, :256] = 255  # left half white
        mask = Image.fromarray(mask_arr)

        # Encode image and mask to base64
        img_buf = BytesIO()
        img.save(img_buf, format="PNG")
        img_b64 = base64.b64encode(img_buf.getvalue()).decode()

        mask_buf = BytesIO()
        mask.save(mask_buf, format="PNG")
        mask_b64 = base64.b64encode(mask_buf.getvalue()).decode()

        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                HF_MODEL_URL,
                headers={"Authorization": f"Bearer {HF_API_TOKEN}"},
                json={
                    "inputs": prompt,
                    "image": img_b64,
                    "mask_image": mask_b64,
                },
            )
            if response.status_code == 200:
                result_b64 = base64.b64encode(response.content).decode()
                return result_b64
            else:
                print(f"HF API error: {response.status_code} {response.text}")
                return ""
    except Exception as e:
        print(f"Inpainting error: {e}")
        return ""


@app.get("/")
async def root():
    return {"message": "backend server for anika's THET287 project"}


@app.get("/create_server")
async def create_server():
    global s
    from _thread import start_new_thread

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    try:
        s.bind((server, port))
    except socket.error as e:
        return {"error": str(e)}

    s.listen(2)
    start_new_thread(accept_connections_thread, ())

    random_int = secrets.randbelow(1000000)
    random_string = f"{random_int:06d}"

    active_servers[random_string] = (server, port)

    prompt = random.choice(PROMPTS)
    game_sessions[random_string] = {
        "players": [],
        "player_ids": [],
        "prompt": prompt,
        "round": 1,
        "strokes": {},
        "started": False,
        "ready_for_round2": 0,
        "round1_canvas": None,   # base64 of canvas at end of round 1
        "ai_result": None,       # base64 of AI inpainted result
    }

    return {"join_code": random_string}


@app.get("/start_game/{code}")
async def start_game(code: str):
    if code not in game_sessions:
        return {"error": "Session not found"}
    game_sessions[code]["started"] = True
    for ws in game_sessions[code]["players"]:
        try:
            await ws.send_json({"type": "game_start"})
        except Exception:
            pass
    return {"status": "started"}


class JoinRequest(BaseModel):
    code: str


@app.post("/join_server")
async def join_server(req: JoinRequest):
    if req.code not in active_servers:
        return {"error": "Invalid join code"}
    server_ip, server_port = active_servers[req.code]
    try:
        client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client_socket.connect((server_ip, server_port))
        return {"status": "connected", "server_ip": server_ip, "port": server_port}
    except socket.error as e:
        return {"error": str(e)}


@app.websocket("/ws/{code}/{player_id}")
async def websocket_endpoint(websocket: WebSocket, code: str, player_id: str):
    if code not in game_sessions:
        await websocket.close()
        return

    await websocket.accept()
    session = game_sessions[code]

    if player_id not in session["player_ids"]:
        session["player_ids"].append(player_id)
        session["players"].append(websocket)
        session["strokes"][player_id] = []
    else:
        idx = session["player_ids"].index(player_id)
        session["players"][idx] = websocket

    player_index = session["player_ids"].index(player_id)
    side = "left" if player_index == 0 else "right"

    await websocket.send_json({
        "type": "init",
        "side": side,
        "prompt": session["prompt"],
        "round": session["round"],
        "player_index": player_index,
    })

    if session.get("started"):
        await websocket.send_json({"type": "game_start"})

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "stroke":
                session["strokes"][player_id].append(data)
                other_index = 1 - player_index
                if other_index < len(session["players"]):
                    other_ws = session["players"][other_index]
                    try:
                        await other_ws.send_json({
                            "type": "partner_stroke",
                            "stroke": data,
                            "from_side": side,
                        })
                    except Exception:
                        pass

            elif msg_type == "round1_done":
                session["ready_for_round2"] += 1

                # Save canvas snapshot and kick off AI inpainting
                if "canvas_b64" in data and not session["round1_canvas"]:
                    session["round1_canvas"] = data["canvas_b64"]
                    # Player 0 drew left, so AI completes right half
                    # Player 1 drew right, so AI completes left half
                    # We use player 0's perspective: left half drawn, AI fills right
                    asyncio.create_task(
                        inpaint_and_notify(session, data["canvas_b64"], complete_right=True)
                    )

                if session["ready_for_round2"] >= 2:
                    session["round"] = 2
                    ids = session["player_ids"]
                    players = session["players"]
                    for i, ws in enumerate(players):
                        partner_id = ids[1 - i]
                        partner_strokes = session["strokes"].get(partner_id, [])
                        partner_side = "right" if i == 0 else "left"
                        try:
                            await ws.send_json({
                                "type": "round2_start",
                                "partner_strokes": partner_strokes,
                                "your_new_side": partner_side,
                            })
                        except Exception:
                            pass

            elif msg_type == "game_over":
                # Send human game over, and AI result if ready
                ai_result = session.get("ai_result", "")
                for ws in session["players"]:
                    try:
                        await ws.send_json({
                            "type": "game_over",
                            "ai_canvas": ai_result,  # may be "" if still processing
                        })
                    except Exception:
                        pass

    except WebSocketDisconnect:
        if websocket in session["players"]:
            idx = session["players"].index(websocket)
            session["players"].pop(idx)
            session["player_ids"].pop(idx)


async def inpaint_and_notify(session: dict, canvas_b64: str, complete_right: bool):
    """Run inpainting and notify players when done."""
    print("Starting AI inpainting...")
    result_b64 = await run_inpainting(canvas_b64, session["prompt"], complete_right)
    session["ai_result"] = result_b64
    print("AI inpainting complete.")

    # If game is already over, push the result to players now
    for ws in session["players"]:
        try:
            await ws.send_json({
                "type": "ai_result_ready",
                "ai_canvas": result_b64,
            })
        except Exception:
            pass


import uvicorn

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)