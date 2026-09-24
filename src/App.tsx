import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ApiKeySetup } from "./components/ApiKeySetup";
import { CaptureZone } from "./components/CaptureZone";
import { ImagePreview } from "./components/ImagePreview";
import type { CapturedImage } from "./lib/image";
import "./App.css";

function App() {
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("get_api_key_status").then(setHasApiKey);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-8 text-neutral-100">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-2xl font-semibold">texnap</h1>
        <p className="text-neutral-400">screenshot / photo → LaTeX</p>
      </div>

      {hasApiKey === null ? (
        <p className="text-sm text-neutral-500">Checking configuration…</p>
      ) : !hasApiKey ? (
        <ApiKeySetup onSaved={() => setHasApiKey(true)} />
      ) : (
        <>
          {error && (
            <div className="w-full max-w-lg rounded-md border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {image ? (
            <ImagePreview image={image} onClear={() => setImage(null)} />
          ) : (
            <CaptureZone
              onCapture={(captured) => {
                setError(null);
                setImage(captured);
              }}
              onError={setError}
            />
          )}
        </>
      )}
    </main>
  );
}

export default App;
