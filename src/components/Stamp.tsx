import { verdictMeta } from "./ui";

type Key = keyof typeof verdictMeta;

/**
 * The verdict is a rubber stamp. It lands once when the verdict changes (the parent
 * re-keys it); with no proof yet it is only an outline of where the stamp will go.
 */
export function Stamp({ verdict }: { verdict: Key }) {
  const m = verdictMeta[verdict];
  const pending = verdict === "idle";
  return (
    <div role="img" aria-label={m.word} className={`stamp ${pending ? "pending" : ""} ${m.color} text-[2.35rem] leading-none`}>
      <span aria-hidden>{m.word}</span>
      <small aria-hidden>{m.sub}</small>
    </div>
  );
}
