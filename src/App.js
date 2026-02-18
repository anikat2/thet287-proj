import { useState } from "react";
import Paint from "./frontend/Paint";
import Lobby from "./frontend/Lobby";

function App() {
    const [session, setSession] = useState(null); // { code, playerId }

    const handleJoin = (code, playerId) => {
        setSession({ code, playerId });
    };

    return (
        <div>
            {session
                ? <Paint code={session.code} playerId={session.playerId} />
                : <Lobby onJoin={handleJoin} />
            }
        </div>
    );
}

export default App;