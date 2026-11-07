// The foot of a keyset list that reads past empty pages (M6–M7 audit AU32, AU50; Payments › Credit at period end, Reconciliation): "Show more" and one live
// line beside it, "Checking older payments…" while the reader reads on, or "No more payments found in these pages…" once a read stopped at its limit with
// pages left. The line's region is always in the page (empty when there is nothing to say), so a screen reader hears each change.
export function KeysetFoot(props: {
  /** The server's next cursor (null: the list ended, no button). */
  cursor: string | null;
  loading: boolean;
  /** `keysetFootLine(checking, stalled)`. */
  line: string;
  moreLabel: string;
  onMore: () => void;
}) {
  return (
    <div className="keyset-foot">
      {props.cursor && (
        <button
          type="button"
          className="btn btn--secondary"
          onClick={props.onMore}
          disabled={props.loading}
          aria-busy={props.loading || undefined}
        >
          {props.loading ? "Loading…" : props.moreLabel}
        </button>
      )}
      <p className="keyset-foot__line" role="status">
        {props.line}
      </p>
    </div>
  );
}
