// A playful "wandering eyes" loader shown while a transcription is generating.
// Hand-built (the requested `npx shadcn add @loading-ui/wandering-eyes` needs a
// shadcn init + a registry this Vite/Tailwind-v4 project doesn't have, which
// would restructure the styling) — same idea, zero risk to the token setup.
export function WanderingEyes({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2">
        <span className="eye">
          <span className="pupil" />
        </span>
        <span className="eye">
          <span className="pupil" />
        </span>
      </div>
      {label && <span className="text-[12px] text-ink-3">{label}</span>}
    </div>
  );
}
