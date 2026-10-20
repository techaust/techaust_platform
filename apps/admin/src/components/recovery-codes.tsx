// Recovery codes [ADM-AUTH-04]: shown once (at enrolment and after "make new codes"), never again. Copy, download
// (a .txt built in the browser) and print; the person confirms they've saved them before going on.
import { formatIstDateTime } from "@techaust/core";
import { useId, useState } from "react";
import { Download, Printer } from "./icons.tsx";
import { CopyButton } from "./ui.tsx";

export function recoveryCodesText(codes: string[], email: string, at: number) {
  return [
    "TecHaust admin: recovery codes",
    `Account: ${email}`,
    `Made: ${formatIstDateTime(at)}`,
    "",
    "Each code works once, in place of an authenticator code when you sign in.",
    "Making new codes stops all of these from working.",
    "",
    ...codes,
    "",
  ].join("\r\n");
}

export function RecoveryCodes(props: {
  codes: string[];
  email: string;
  onDone: () => void;
  doneLabel: string;
}) {
  const [saved, setSaved] = useState(false);
  const [at] = useState(() => Date.now());
  const hintId = useId();
  const text = recoveryCodesText(props.codes, props.email, at);

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "techaust-admin-recovery-codes.txt";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="recovery">
      <p>
        If you lose your phone, each of these codes lets you sign in once in place of an authenticator code.
        Keep them somewhere safe and offline, such as a password manager or a printed copy.
      </p>
      <p className="recovery__once">You'll only see these codes now.</p>

      <section className="slip print-area" aria-labelledby={`${hintId}-slip`}>
        <h2 className="slip__title" id={`${hintId}-slip`}>
          Recovery codes
        </h2>
        <p className="slip__meta">
          <span>{props.email}</span>
          <span>{formatIstDateTime(at)}</span>
        </p>
        <ul className="slip__codes">
          {props.codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <p className="slip__note">Each code works once.</p>
      </section>

      <div className="actions-row">
        <CopyButton text={props.codes.join("\n")} label="Copy codes" />
        <button type="button" className="btn btn--secondary" onClick={download}>
          <Download size={20} />
          Download
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => window.print()}>
          <Printer size={20} />
          Print
        </button>
      </div>

      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>I've saved these codes somewhere safe</span>
      </label>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={props.onDone}
        disabled={!saved}
        aria-describedby={saved ? undefined : hintId}
      >
        {props.doneLabel}
      </button>
      {!saved && (
        <p className="hint hint--below" id={hintId}>
          Tick the box above once your codes are saved.
        </p>
      )}
    </div>
  );
}
