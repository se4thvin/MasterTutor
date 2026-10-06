import { Button } from "./button.tsx";
import { Icon } from "./icon.tsx";

/** A query that failed: says so in fixed copy and offers Retry, instead of an endless skeleton. */
export function LoadError({
  title,
  onRetry,
  retrying = false,
}: {
  title: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="load-error group" role="alert">
      <Icon name="needsReview" />
      <p>{title}</p>
      <Button onClick={onRetry} disabled={retrying}>
        Retry
      </Button>
    </div>
  );
}
