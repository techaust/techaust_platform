// Gateways (ADM-SET-06): Razorpay, Stripe and PayPal, each with its mode (test or live) and whether its keys are set.
// Keys are never typed here: they are Worker secrets, and the API reports only "configured" or "missing" by name. Live
// stays locked until the owner's go-live (PAYMENTS_LIVE_ALLOWED, Phase 7); the API refuses it too (409 `live_locked`).
// A change needs a fresh step-up (gateways.manage), which the API asks for on save.
import { GATEWAYS, type Gateway, type Settings } from "@techaust/core/settings";
import { type FormEvent, useState } from "react";
import { api, errorText, type GatewayMeta, RequestError, type SettingsDoc } from "../../api.ts";
import { StatusPill } from "../../components/display.tsx";
import { SaveBar } from "../../components/form.tsx";
import { Lock } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { FormSkeleton, StaleNotice } from "./kit.tsx";

const ABOUT: Record<Gateway, { name: string; for: string }> = {
  razorpay: { name: "Razorpay", for: "INR: UPI, cards, netbanking" },
  stripe: { name: "Stripe", for: "USD: cards" },
  paypal: { name: "PayPal", for: "USD: PayPal balance and cards" },
};

export function Gateways() {
  const loaded = useLoad(() => api.gateways(), "");
  if (loaded.state === "loading") return <FormSkeleton />;
  if (loaded.state === "failed") return <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} />;
  return <GatewayForm key={loaded.data.version} doc={loaded.data} reload={() => loaded.reload(true)} />;
}

function GatewayForm({ doc, reload }: { doc: SettingsDoc<"gateways">; reload: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState<Settings["gateways"]>(doc.value);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const meta: GatewayMeta = doc.meta;
  const dirty = JSON.stringify(value) !== JSON.stringify(doc.value);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.saveGateways(doc.version, value);
      toast("success", r.changed ? "Gateway modes saved." : "No change.");
      reload();
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {stale && <StaleNotice onReload={reload} />}
      <Notice tone="info">
        Keys are never typed here. They're stored as Cloudflare secrets, and this page only shows whether each
        one is set. They're added with the owner's go-live, and live mode opens then too.
      </Notice>
      {failure && <Notice tone="error">{failure}</Notice>}
      <form id="gateways-form" onSubmit={save} noValidate>
        <ul className="gateways">
          {GATEWAYS.map((g) => {
            const status = meta.status[g];
            const liveId = `gw-${g}-live`;
            return (
              <li key={g} className="gateway">
                <div className="gateway__head">
                  <h2 className="gateway__name">{ABOUT[g].name}</h2>
                  <p className="gateway__for">{ABOUT[g].for}</p>
                </div>
                <fieldset className="segmented" disabled={busy}>
                  <legend className="visually-hidden">{ABOUT[g].name} mode</legend>
                  <label className="segmented__opt">
                    <input
                      type="radio"
                      name={`gw-${g}`}
                      checked={value[g].mode === "test"}
                      onChange={() => setValue({ ...value, [g]: { mode: "test" } })}
                    />
                    Test
                  </label>
                  <label className="segmented__opt">
                    <input
                      type="radio"
                      name={`gw-${g}`}
                      checked={value[g].mode === "live"}
                      disabled={!meta.liveAllowed && value[g].mode !== "live"}
                      aria-describedby={meta.liveAllowed ? undefined : liveId}
                      onChange={() => setValue({ ...value, [g]: { mode: "live" } })}
                    />
                    {!meta.liveAllowed && <Lock size={16} />}
                    Live
                  </label>
                </fieldset>
                {!meta.liveAllowed && (
                  <p className="gateway__live hint" id={liveId}>
                    Live is locked until go-live.
                  </p>
                )}
                <div className="gateway__keys">
                  <span className="muted">Keys</span>
                  {status.configured ? (
                    <StatusPill tone="success" icon="check">
                      Configured
                    </StatusPill>
                  ) : (
                    <StatusPill tone="warning" icon="clock">
                      Missing
                    </StatusPill>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </form>
      <SaveBar dirty={dirty} busy={busy} form="gateways-form" onDiscard={() => setValue(doc.value)} />
      <UnsavedChangesGuard dirty={dirty && !busy} what="the gateway modes" />
    </>
  );
}
