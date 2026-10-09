import { Icon } from "@/components/ui/icon.tsx";

/**
 * D44: informed consent for Bypass, the same wherever it is chosen (New task, or a running run's
 * mode control): everything bypass lifts, everything it never lifts, and an explicit checkbox.
 */
export function BypassConsent({
  id,
  checked,
  onChange,
  label,
}: {
  /** The warning's id, which the checkbox points to. */
  id: string;
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
}) {
  return (
    <>
      <div className="nt-risk" id={id} data-testid="bypass-warning">
        <Icon name="needsReview" size="sm" />
        <div>
          <p>
            Bypass approves every step on its own: purchases, deletions, posts, form submits,
            downloads, new domains, first use of a saved sign-in, frames it can&apos;t inspect, and
            irrelevant- or sensitive-site warnings.
          </p>
          <p>
            It never lifts these: prompt-injection warnings still stop for you. Budget limits still
            pause. Secrets never reach the agent, logs or screenshots. Sign-ins never go to another
            site without you. No access to private networks. The kill switch and Take over always
            work.
          </p>
          <p>
            It still pauses for a person on a sign-in form that posts to another site, and on safety
            warnings it doesn&apos;t recognise.
          </p>
        </div>
      </div>
      <label className="nt-check">
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={id}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
    </>
  );
}
