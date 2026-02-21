import { Icon } from "@/components/ui/icon.tsx";

const OBJECTS = [
  {
    icon: "agentNote",
    title: "The agent",
    lead: "Sees an alias.",
    text: "The model asks for a sign-in by name. It never receives a value.",
  },
  {
    icon: "vault",
    title: "The vault",
    lead: "Sealed at rest.",
    text: "Sealed the moment you save. Only the browser executor opens it, for one fill.",
  },
  {
    icon: "web",
    title: "The website",
    lead: "Filled in place.",
    text: "Typed into the page on the pinned website only. Screenshots are masked.",
  },
] as const;

/** The vault "cutaway" (mockup D). Captions sit in flow under each object, so they can't collide. */
export function Cutaway() {
  return (
    <figure className="cutaway" aria-label="How the vault keeps secrets from the agent">
      {OBJECTS.map((o, i) => (
        <div key={o.title} className="cutaway-obj">
          <span className="cutaway-art">
            <Icon name={o.icon} size="xl" />
          </span>
          <b>{o.title}</b>
          <p className="cap">
            <b>{o.lead}</b> {o.text}
          </p>
          {i < OBJECTS.length - 1 ? <span className="cutaway-link" aria-hidden="true" /> : null}
        </div>
      ))}
    </figure>
  );
}
