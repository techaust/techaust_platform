// Who is signed in, and the two ways out (POR-02): on md and wider a disclosure in the band (a button and a panel, not
// role="menu": it holds text as well as actions); below md the same content sits in the full-screen menu with the
// sections. "Sign out of all devices" asks first (ConfirmDialog, M1.6 wording).
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { PENDING, WORDS } from "../../copy-documents.ts";

import { ConfirmDialog } from "../dialog.tsx";
import { ChevronDown, LogOut, Menu, X } from "../icons.tsx";
import { Notice } from "../ui.tsx";
import { NAV, type NavKey } from "./nav.tsx";

export type AccountProps = {
  org: string;
  contact: { name: string; email: string };
  /** Ends this session. Throws an Error whose message is shown. */
  onSignOut: () => Promise<void>;
  /** Ends this contact's sessions for this organisation on every device. Throws an Error whose message is shown. */
  onSignOutAll: () => Promise<void>;
};

/** The signed-in details and the sign-out actions, shared by the panel and the phone menu. */
function AccountBody(props: AccountProps & { onConfirming: (v: boolean) => void }) {
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await props.onSignOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="acct">
      <div className="acct__who">
        <p className="acct__as">
          {WORDS.signedInAs} <strong>{props.contact.name}</strong>
        </p>
        <p className="acct__email">{props.contact.email}</p>
        <p className="acct__org">{props.org}</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={signOut}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <LogOut size={20} />
        {busy ? WORDS.signingOut : WORDS.signOut}
      </button>
      <div className="acct__all">
        <button
          type="button"
          className="btn btn--text"
          onClick={() => props.onConfirming(true)}
          disabled={busy}
          aria-describedby={hintId}
        >
          {WORDS.allDevices}
        </button>
        <p className="hint" id={hintId}>
          {WORDS.allDevicesHint(props.org)}
        </p>
      </div>
    </div>
  );
}

function AllDevicesDialog(props: AccountProps & { open: boolean; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={props.open}
      title={WORDS.confirmAllTitle}
      confirmLabel={WORDS.allDevices}
      busyLabel={WORDS.signingOut}
      onConfirm={async () => {
        await props.onSignOutAll();
        props.onClose();
      }}
      onClose={props.onClose}
    >
      <p>{WORDS.confirmAllBody(props.org)}</p>
    </ConfirmDialog>
  );
}

/** md and wider: the client's name and the contact's on a button; the panel opens under it. */
export function AccountMenu(props: AccountProps & { defaultOpen?: boolean | undefined }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [confirming, setConfirming] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    const box = wrap.current;
    if (!open || confirming || !box) return;
    const onDown = (e: PointerEvent) => {
      if (!box.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    // Focus left the button and the panel (Tab past the last action): close, as a disclosure does.
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget && !box.contains(e.relatedTarget as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    box.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      box.removeEventListener("focusout", onFocusOut);
    };
  }, [open, confirming]);

  return (
    <div className="account" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="account__btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="visually-hidden">{PENDING.account}: </span>
        <span className="account__text">
          <span className="account__org">{props.org}</span>
          <span className="account__name">{props.contact.name}</span>
        </span>
        <ChevronDown size={20} />
      </button>
      <div className="account__panel" id={panelId} hidden={!open}>
        <AccountBody {...props} onConfirming={setConfirming} />
      </div>
      <AllDevicesDialog {...props} open={confirming} onClose={() => setConfirming(false)} />
    </div>
  );
}

/** Below md: one "Menu" button opens the sections and the account, full screen. */
export function MobileMenu(
  props: AccountProps & { current: NavKey | null; hrefOf: (key: NavKey) => string },
) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="pbar__menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu size={24} />
        {PENDING.menu}
      </button>
      <dialog
        ref={ref}
        className="mmenu"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        {open && (
          <div className="mmenu__inner">
            <div className="mmenu__top">
              <img src={logoDark} alt="TecHaust Technologies" width="171" height="24" />
              <h2 id={titleId} className="visually-hidden">
                {PENDING.menu}
              </h2>
              <button type="button" className="mmenu__close" onClick={() => setOpen(false)}>
                <X size={24} />
                <span className="visually-hidden">{PENDING.closeMenu}</span>
              </button>
            </div>
            <nav aria-label="Portal">
              <ul className="mmenu__list">
                {NAV.map((item) => (
                  <li key={item.key}>
                    <Link
                      to={props.hrefOf(item.key)}
                      className="mmenu__link"
                      aria-current={props.current === item.key ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="mmenu__account">
              <AccountBody {...props} onConfirming={setConfirming} />
            </div>
          </div>
        )}
      </dialog>
      {/* A sibling, not a child: the menu's on-ink colours must not reach the dialog. */}
      <AllDevicesDialog {...props} open={confirming} onClose={() => setConfirming(false)} />
    </>
  );
}
