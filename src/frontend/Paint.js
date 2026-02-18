import { useEffect, useRef, useState, useCallback } from "react";

const ROUND_DURATION = 30;
const WS_URL = "ws://localhost:8000/ws";
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 500;
const HALF = CANVAS_WIDTH / 2;

function Timer({ seconds, label }) {
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const urgent = seconds <= 30;
    return (
        <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: "2.5rem",
            fontWeight: "bold",
            color: urgent ? "#ff4444" : "#f0e6d3",
            textShadow: urgent ? "0 0 20px #ff444488" : "none",
            letterSpacing: "0.1em",
            transition: "color 0.3s",
        }}>
            {label} {mins}:{secs}
        </div>
    );
}

function EndScreen({ humanCanvasRef, aiCanvas }) {
    const aiRef = useRef(null);

    useEffect(() => {
        if (!aiCanvas || !aiRef.current) return;
        const img = new Image();
        img.onload = () => {
            const ctx = aiRef.current.getContext("2d");
            // Scale from 512x512 back to 900x500
            ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        };
        img.src = `data:image/png;base64,${aiCanvas}`;
    }, [aiCanvas]);

    const containerStyle = {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "32px",
        padding: "40px",
    };

    const labelStyle = {
        color: "#a89bc2",
        fontFamily: "'Courier New', monospace",
        letterSpacing: "0.2em",
        fontSize: "0.9rem",
        marginBottom: "8px",
        textAlign: "center",
    };

    const canvasStyle = {
        borderRadius: "8px",
        boxShadow: "0 0 40px #00000088",
        maxWidth: "100%",
        border: "2px solid #302b63",
    };

    return (
        <div style={containerStyle}>
            <div style={{
                color: "#f4a261",
                fontFamily: "'Courier New', monospace",
                fontSize: "2rem",
                letterSpacing: "0.2em",
            }}>
                🎨 GAME OVER
            </div>

            <div>
                <div style={labelStyle}>👥 HUMAN COLLABORATION</div>
                <canvas
                    ref={humanCanvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    style={canvasStyle}
                />
            </div>

            <div style={{
                color: "#a89bc2",
                fontFamily: "'Courier New', monospace",
                fontSize: "1rem",
                letterSpacing: "0.3em",
            }}>VS</div>

            <div>
                <div style={labelStyle}>🤖 AI COMPLETION</div>
                {aiCanvas ? (
                    <canvas
                        ref={aiRef}
                        width={CANVAS_WIDTH}
                        height={CANVAS_HEIGHT}
                        style={canvasStyle}
                    />
                ) : (
                    <div style={{
                        width: CANVAS_WIDTH,
                        height: CANVAS_HEIGHT,
                        background: "#1a1a3e",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#a89bc2",
                        fontFamily: "'Courier New', monospace",
                        letterSpacing: "0.15em",
                        fontSize: "1rem",
                        border: "2px solid #302b63",
                    }}>
                        ⏳ AI IS PAINTING...
                    </div>
                )}
            </div>
        </div>
    );
}

export default function Paint({ code, playerId }) {
    const canvasRef = useRef(null);
    const wsRef = useRef(null);
    const drawingRef = useRef(false);
    const lastPosRef = useRef({ x: 0, y: 0 });
    const ctxRef = useRef(null);

    const [side, setSide] = useState(null);
    const [round, setRound] = useState(1);
    const [prompt, setPrompt] = useState("");
    const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);
    const [phase, setPhase] = useState("waiting");
    const [color, setColor] = useState("#1a1a2e");
    const [brushSize, setBrushSize] = useState(4);
    const [tool, setTool] = useState("pen");
    const [aiCanvas, setAiCanvas] = useState(null);
    const timerRef = useRef(null);
    const roundRef = useRef(1);
    const sideRef = useRef(null);

    const clampX = useCallback((x, currentSide) => {
        if (currentSide === "left") return Math.min(x, HALF);
        if (currentSide === "right") return Math.max(x, HALF);
        return x;
    }, []);

    const getCanvasPos = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = CANVAS_WIDTH / rect.width;
        const scaleY = CANVAS_HEIGHT / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    };

    const drawStroke = useCallback((ctx, x0, y0, x1, y1, strokeColor, size, eraser) => {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = eraser ? "#f5f0e8" : strokeColor;
        ctx.lineWidth = eraser ? size * 3 : size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.restore();
    }, []);

    const drawDivider = useCallback((ctx) => {
        ctx.save();
        ctx.strokeStyle = "#cccccc66";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(HALF, 0);
        ctx.lineTo(HALF, CANVAS_HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }, []);

    const replayStrokes = useCallback((strokes, ctx) => {
        strokes.forEach((s) => {
            if (s.type === "stroke") {
                drawStroke(ctx, s.x0, s.y0, s.x1, s.y1, s.color, s.size, s.eraser);
            }
        });
    }, [drawStroke]);

    const getCanvasBase64 = useCallback(() => {
        const canvas = canvasRef.current;
        // Strip the data:image/png;base64, prefix
        return canvas.toDataURL("image/png").split(",")[1];
    }, []);

    const startTimer = useCallback((onDone) => {
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeLeft(ROUND_DURATION);
        let t = ROUND_DURATION;
        timerRef.current = setInterval(() => {
            t -= 1;
            setTimeLeft(t);
            if (t <= 0) {
                clearInterval(timerRef.current);
                onDone();
            }
        }, 1000);
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        ctxRef.current = ctx;
        ctx.fillStyle = "#f5f0e8";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        drawDivider(ctx);
    }, [drawDivider]);

    useEffect(() => {
        if (!code || !playerId) return;

        const ws = new WebSocket(`${WS_URL}/${code}/${playerId}`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const ctx = ctxRef.current;

            if (data.type === "init") {
                setSide(data.side);
                sideRef.current = data.side;
                setPrompt(data.prompt);
                setRound(data.round);
                roundRef.current = data.round;
            }

            if (data.type === "game_start") {
                setPhase("playing");
                startTimer(() => {
                    // Round 1 timer done — send canvas snapshot + signal
                    const b64 = getCanvasBase64();
                    wsRef.current?.send(JSON.stringify({
                        type: "round1_done",
                        canvas_b64: b64,
                    }));
                    setPhase("transition");
                });
            }

            if (data.type === "partner_stroke") {
                const s = data.stroke;
                drawStroke(ctx, s.x0, s.y0, s.x1, s.y1, s.color, s.size, s.eraser);
            }

            if (data.type === "round2_start") {
                roundRef.current = 2;
                setRound(2);
                setSide(data.your_new_side);
                sideRef.current = data.your_new_side;

                replayStrokes(data.partner_strokes, ctx);
                drawDivider(ctx);

                setPhase("playing");
                startTimer(() => {
                    wsRef.current?.send(JSON.stringify({ type: "game_over" }));
                    setPhase("gameover");
                });
            }

            if (data.type === "game_over") {
                setPhase("gameover");
                if (timerRef.current) clearInterval(timerRef.current);
                if (data.ai_canvas) setAiCanvas(data.ai_canvas);
            }

            if (data.type === "ai_result_ready") {
                setAiCanvas(data.ai_canvas);
            }
        };

        ws.onclose = () => console.log("WebSocket closed");

        return () => {
            ws.close();
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [code, playerId, drawStroke, replayStrokes, drawDivider, startTimer, getCanvasBase64]);

    const onMouseDown = (e) => {
        if (phase !== "playing") return;
        drawingRef.current = true;
        const pos = getCanvasPos(e);
        lastPosRef.current = { x: clampX(pos.x, sideRef.current), y: pos.y };
    };

    const onMouseMove = (e) => {
        if (!drawingRef.current || phase !== "playing") return;
        const ctx = ctxRef.current;
        const pos = getCanvasPos(e);
        const x1 = clampX(pos.x, sideRef.current);
        const y1 = pos.y;
        const { x: x0, y: y0 } = lastPosRef.current;

        drawStroke(ctx, x0, y0, x1, y1, color, brushSize, tool === "eraser");

        wsRef.current?.send(JSON.stringify({
            type: "stroke", x0, y0, x1, y1,
            color, size: brushSize, eraser: tool === "eraser",
        }));
        lastPosRef.current = { x: x1, y: y1 };
    };

    const onMouseUp = () => { drawingRef.current = false; };

    const colors = ["#1a1a2e", "#e63946", "#457b9d", "#2d6a4f", "#f4a261", "#9b2226", "#6d6875", "#ffffff"];

    if (phase === "gameover") {
        return (
            <div style={{
                minHeight: "100vh",
                background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                overflowY: "auto",
                padding: "20px",
            }}>
                <EndScreen humanCanvasRef={canvasRef} aiCanvas={aiCanvas} />
            </div>
        );
    }

    return (
        <div style={{
            minHeight: "100vh",
            background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            fontFamily: "'Courier New', monospace",
        }}>
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                maxWidth: CANVAS_WIDTH,
                marginBottom: "12px",
            }}>
                <div style={{ color: "#a89bc2", fontSize: "0.9rem", letterSpacing: "0.15em" }}>
                    {phase === "waiting" ? "⏳ WAITING FOR HOST TO START..." :
                     phase === "transition" ? "⏳ WAITING FOR ROUND 2..." :
                     side === "left" ? "◀ LEFT HALF" : "▶ RIGHT HALF"}
                </div>
                <div style={{ color: "#f0e6d3", fontSize: "1rem", letterSpacing: "0.1em", textAlign: "center" }}>
                    🎨 <strong>{prompt || "..."}</strong>
                </div>
                <div style={{ color: "#a89bc2", fontSize: "0.9rem", letterSpacing: "0.15em" }}>
                    {phase === "playing" ? `ROUND ${round}` : ""}
                </div>
            </div>

            {phase === "playing" && (
                <Timer seconds={timeLeft} label={`ROUND ${round}`} />
            )}

            {phase === "playing" && (
                <div style={{ color: "#a89bc2", fontSize: "0.8rem", letterSpacing: "0.2em", marginBottom: "8px" }}>
                    {round === 1 ? "ROUND 1 — Draw your half" : "ROUND 2 — Complete your partner's canvas"}
                </div>
            )}

            <div style={{ position: "relative", boxShadow: "0 0 60px #00000088" }}>
                <canvas
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    style={{
                        display: "block",
                        maxWidth: "100%",
                        cursor: phase === "playing" ? (tool === "eraser" ? "cell" : "crosshair") : "default",
                        borderRadius: "4px",
                        border: "2px solid #302b63",
                    }}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                />
                {phase === "playing" && (
                    <div style={{
                        position: "absolute",
                        top: 8,
                        left: side === "left" ? 8 : HALF + 8,
                        background: "#302b6388",
                        color: "#f0e6d3",
                        padding: "4px 10px",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        letterSpacing: "0.1em",
                        pointerEvents: "none",
                    }}>
                        YOUR ZONE
                    </div>
                )}
            </div>

            {phase === "playing" && (
                <div style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                    marginTop: "16px",
                    background: "#1a1a3e",
                    padding: "12px 20px",
                    borderRadius: "50px",
                    boxShadow: "0 4px 20px #00000066",
                }}>
                    {colors.map(c => (
                        <div
                            key={c}
                            onClick={() => { setColor(c); setTool("pen"); }}
                            style={{
                                width: 28, height: 28,
                                borderRadius: "50%",
                                background: c,
                                cursor: "pointer",
                                border: color === c && tool === "pen" ? "3px solid #f0e6d3" : "3px solid transparent",
                                boxShadow: c === "#ffffff" ? "0 0 0 1px #666 inset" : "none",
                                transition: "transform 0.1s",
                                transform: color === c && tool === "pen" ? "scale(1.2)" : "scale(1)",
                            }}
                        />
                    ))}
                    <div style={{ width: 1, height: 28, background: "#ffffff22" }} />
                    <button
                        onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}
                        style={{
                            background: tool === "eraser" ? "#f0e6d3" : "transparent",
                            color: tool === "eraser" ? "#1a1a2e" : "#f0e6d3",
                            border: "2px solid #f0e6d344",
                            borderRadius: "20px",
                            padding: "4px 14px",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: "0.8rem",
                            letterSpacing: "0.1em",
                        }}
                    >
                        ERASER
                    </button>
                    <input
                        type="range" min={2} max={24} value={brushSize}
                        onChange={e => setBrushSize(Number(e.target.value))}
                        style={{ width: 80, accentColor: "#a89bc2" }}
                    />
                </div>
            )}
        </div>
    );
}