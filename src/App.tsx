import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Temporary P0 sanity check: confirms Vite+React render, Tailwind styles apply,
// and the Tauri IPC bridge to Rust works. Replaced by the real capture UI in P1.
function App() {
  const [bridgeStatus, setBridgeStatus] = useState("checking Rust bridge...");

  useEffect(() => {
    invoke<string>("greet", { name: "texnap" })
      .then((msg) => setBridgeStatus(msg))
      .catch(() => setBridgeStatus("Rust bridge failed"));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-100">
      <h1 className="text-2xl font-semibold">texnap</h1>
      <p className="text-neutral-400">screenshot / photo → LaTeX</p>
      <p className="rounded-md bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
        {bridgeStatus}
      </p>
    </main>
  );
}

export default App;
