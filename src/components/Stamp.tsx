import { verdictMeta } from "./ui";

type Key = keyof typeof verdictMeta;

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The verdict is a sticker slapped onto the page. It lands once when the verdict
 * changes (the parent re-keys it), with a burst of sparks. With no run yet it is a
 * dashed outline floating where the sticker will go.
 */
export function Stamp({ verdict }: { verdict: Key }) {
  const m = verdictMeta[verdict];
  const idle = verdict === "idle";
  return (
    <div className="relative inline-block">
      {!idle && (
        <span className="sparks" aria-hidden>
          {ANGLES.map((a) => (
            <i key={a} style={{ ["--a" as string]: a }} />
          ))}
        </span>
      )}
      <div role="img" aria-label={`${m.word}: ${m.sub}`} className={`sticker ${idle ? "idle text-cream/80" : m.bg} text-[2.6rem] sm:text-[3.1rem]`} style={idle ? { borderColor: "var(--cream)" } : undefined}>
        <span aria-hidden>{m.word}</span>
        <small aria-hidden>{m.sub}</small>
      </div>
    </div>
  );
}
