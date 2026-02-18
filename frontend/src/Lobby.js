import { useEffect, useState } from "react";

function Lobby({ onJoin }) {
    const [code, setCode] = useState("");
    const [inputCode, setInputCode] = useState("");
    const [isHost, setIsHost] = useState(false);
    const [sessionCode, setSessionCode] = useState("");

    const joinServer = async (joinCode) => {
        const codeToUse = joinCode ?? inputCode;
        const response = await fetch("http://localhost:8000/join_server", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: codeToUse })
        });
        const join_json = await response.json();

        if ("error" in join_json) {
            alert("Error: " + join_json.error);
            return;
        }

        const playerId = crypto.randomUUID();
        onJoin(codeToUse, playerId);
    };

    const createServer = async () => {
        const response = await fetch("http://localhost:8000/create_server");
        const data = await response.json();
        if ("error" in data) { alert("Error: " + data.error); return; }
        setCode(data.join_code);
        setSessionCode(data.join_code);
        setIsHost(true);
    };

    const startGame = async () => {
        await fetch(`http://localhost:8000/start_game/${sessionCode}`);
        const playerId = crypto.randomUUID();
        onJoin(sessionCode, playerId);
    };

    const btnStyle = {
        fontFamily: "'Courier New', monospace",
        fontSize: "1rem",
        letterSpacing: "0.2em",
        borderRadius: "50px",
        padding: "14px 40px",
        cursor: "pointer",
        fontWeight: "bold",
        border: "none",
    };

    return (
        <div style={{
            minHeight: "100vh",
            background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "20px",
            fontFamily: "'Courier New', monospace",
            color: "#f0e6d3",
        }}>
            <h1 style={{ letterSpacing: "0.3em", fontSize: "2.5rem", margin: 0 }}>🎨 SPLIT DRAW</h1>
            <p style={{ color: "#a89bc2", letterSpacing: "0.15em", margin: 0 }}>
                draw half. complete a stranger's other half.
            </p>

            {code && (
                <div style={{
                    background: "#1a1a3e",
                    border: "2px solid #a89bc2",
                    borderRadius: "12px",
                    padding: "16px 32px",
                    textAlign: "center",
                }}>
                    <div style={{ fontSize: "0.8rem", letterSpacing: "0.2em", color: "#a89bc2" }}>LOBBY CODE</div>
                    <div style={{ fontSize: "3rem", letterSpacing: "0.4em", fontWeight: "bold" }}>{code}</div>
                    <div style={{ fontSize: "0.75rem", color: "#a89bc288" }}>share this with your partner</div>
                </div>
            )}

            {/* ✅ Conditional is now inside the return */}
            {isHost ? (
                <button onClick={startGame} style={{ ...btnStyle, background: "#f4a261", color: "#1a1a2e" }}>
                    START GAME
                </button>
            ) : (
                <button onClick={createServer} style={{ ...btnStyle, background: "#f0e6d3", color: "#1a1a2e" }}>
                    CREATE LOBBY
                </button>
            )}

            {!isHost && (
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        placeholder="enter join code"
                        value={inputCode}
                        onChange={(e) => setInputCode(e.target.value)}
                        style={{
                            background: "#1a1a3e",
                            border: "2px solid #a89bc2",
                            borderRadius: "50px",
                            padding: "12px 24px",
                            color: "#f0e6d3",
                            fontFamily: "'Courier New', monospace",
                            fontSize: "1rem",
                            letterSpacing: "0.2em",
                            outline: "none",
                            textAlign: "center",
                        }}
                    />
                    <button
                        onClick={() => joinServer()}
                        style={{
                            background: "transparent",
                            color: "#f0e6d3",
                            border: "2px solid #f0e6d3",
                            borderRadius: "50px",
                            padding: "12px 28px",
                            fontFamily: "'Courier New', monospace",
                            fontSize: "1rem",
                            letterSpacing: "0.2em",
                            cursor: "pointer",
                        }}
                    >
                        JOIN
                    </button>
                </div>
            )}
        </div>
    );
}

export default Lobby;