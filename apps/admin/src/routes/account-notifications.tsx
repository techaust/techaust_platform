// Your account › Notifications (M7.2; ADM-G-09; owner's answers Q1 A and Q2 A; run file G1): each member chooses which bell alerts also come by email, and an
// owner switches the weekly digest (owners only, L7). Every member reads the "client opened a proposal or estimate" switch (off until switched on, Q2 A); the
// payment and connection alerts ring owners only, so their switches show for owners. One form with the shared save bar: a save sends only what changed, with
// the row's version (409 `stale_version` offers the latest). The emails' "Change notification settings" link lands here (`NOTIFICATIONS_PATH` in core).
import { PREF_GROUP_LABELS } from "@techaust/core/copy-zq";
import { PREF_GROUPS, type PrefGroup } from "@techaust/core/notifications";
import { type FormEvent, useState } from "react";
import { RequestError } from "../api.ts";
import { PageHeader } from "../components/display.tsx";
import { SaveBar, SettingRow, Switch } from "../components/form.tsx";
import { LoadFailed, StaleNotice, useLoad } from "../components/states.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice, SkeletonRows } from "../components/ui.tsx";
import { sentenceStart, ZQ_UI, zqErrorText } from "../lib/copy-zq.ts";
import { m72Api, type Prefs, type PrefsAnswer } from "../lib/m72-api.ts";
import { useUser } from "../session.tsx";

const OWNER_ONLY: readonly PrefGroup[] = ["paymentReceived", "approvals", "hookFailed"];

export function Component() {
  const page = useLoad(() => m72Api.prefs(), "prefs");
  return (
    <div className="page" aria-busy={page.state === "loading" || undefined}>
      <PageHeader
        title={ZQ_UI.prefsTitle}
        crumbs={[{ label: "Your account", to: "/account" }]}
        lede={ZQ_UI.prefsLede}
      />
      {page.state === "failed" ? (
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      ) : page.state === "loading" ? (
        <section className="section" aria-label={ZQ_UI.prefsEmailsHeading}>
          <SkeletonRows n={3} />
        </section>
      ) : (
        <PrefsForm key={page.data.updatedAt ?? "new"} data={page.data} reload={() => page.reload()} />
      )}
    </div>
  );
}

function PrefsForm(props: { data: PrefsAnswer; reload: () => void }) {
  const user = useUser();
  const toast = useToast();
  const owner = user.role === "owner";
  const [base, setBase] = useState<PrefsAnswer>(props.data);
  const [f, setF] = useState<Prefs>(props.data.prefs);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const changes = (Object.keys(f) as (keyof Prefs)[]).filter((k) => f[k] !== base.prefs[k]);
  const dirty = changes.length > 0;
  const groups = PREF_GROUPS.filter((g) => owner || !OWNER_ONLY.includes(g));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const next = await m72Api.savePrefs(
        Object.fromEntries(changes.map((k) => [k, f[k]])) as Partial<Prefs>,
        base.updatedAt,
      );
      setBase(next);
      setF(next.prefs);
      toast("success", ZQ_UI.prefsSaved);
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else setFailure(zqErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof Prefs, on: boolean) => {
    setF((x) => ({ ...x, [k]: on }));
    setFailure(null);
  };

  return (
    <form id="prefs-form" onSubmit={submit} noValidate>
      {stale && <StaleNotice title={ZQ_UI.prefsStale} onReload={props.reload} />}
      {failure && <Notice tone="error">{failure}</Notice>}
      <section className="section" aria-labelledby="np-emails-h">
        <div className="section__head">
          <h2 id="np-emails-h">{ZQ_UI.prefsEmailsHeading}</h2>
          <p className="hint">{ZQ_UI.prefsEmailsHint}</p>
        </div>
        <div className="settings-rows">
          {groups.map((g) => (
            <SettingRow
              key={g}
              id={`np-${g}`}
              label={sentenceStart(PREF_GROUP_LABELS[g])}
              description={ZQ_UI.prefsHint[g]}
            >
              <Switch
                id={`np-${g}-sw`}
                checked={f[g]}
                onChange={(on) => set(g, on)}
                labelledBy={`np-${g}-label`}
                describedBy={`np-${g}-desc`}
                disabled={busy}
              />
            </SettingRow>
          ))}
        </div>
        {!owner && <p className="hint">{ZQ_UI.prefsOwnerOnly}</p>}
      </section>

      {base.digestAvailable && (
        <section className="section" aria-labelledby="np-digest-h">
          <div className="section__head">
            <h2 id="np-digest-h">{ZQ_UI.digestHeading}</h2>
          </div>
          <div className="settings-rows">
            <SettingRow
              id="np-digest"
              label={ZQ_UI.digestRow}
              description={
                <>
                  {ZQ_UI.digestHint}
                  {base.digestOffVia === "one_click" && !base.prefs.digestWeekly && (
                    <>
                      {" "}
                      <strong>{ZQ_UI.digestOffOneClick}</strong>
                    </>
                  )}
                </>
              }
            >
              <Switch
                id="np-digest-sw"
                checked={f.digestWeekly}
                onChange={(on) => set("digestWeekly", on)}
                labelledBy="np-digest-label"
                describedBy="np-digest-desc"
                disabled={busy}
              />
            </SettingRow>
          </div>
        </section>
      )}
      <SaveBar dirty={dirty} busy={busy} form="prefs-form" onDiscard={() => setF(base.prefs)} />
    </form>
  );
}
