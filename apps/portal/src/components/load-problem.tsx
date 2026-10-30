// A screen whose read failed (final sweep P1): it keeps the page's own title as its one h1 (so the tab title, the focus after a move and a
// screen reader's page outline stay right), then says what happened in the shared words (the network, or our side) and offers to reload.
import type { ReactNode } from "react";
import { RequestError } from "../api.ts";
import { COPY } from "../copy.ts";
import { PageTitle } from "./shell/portal-shell.tsx";
import { Notice } from "./ui.tsx";

/** The words of a failed request: the network, or our side. */
export const problemText = (e: unknown) =>
  e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.network;

export function LoadProblemScreen(props: {
  title: string;
  error: unknown;
  onRetry: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="screen">
      <header className="screen__head">
        <PageTitle text={props.title} className="screen__title">
          {props.title}
        </PageTitle>
      </header>
      {props.children}
      <Notice tone="error">{problemText(props.error)}</Notice>
      <button type="button" className="btn btn--secondary" onClick={props.onRetry}>
        {COPY.reload}
      </button>
    </div>
  );
}
