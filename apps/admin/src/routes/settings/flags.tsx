// Feature flags (ADM-SET-10): the website's switches (the DPDP readiness page, the blog, the Cal.com link, the WhatsApp
// number, the Google Analytics ID) and the admin's weekly digest. Website values reach the site only through the publish
// snapshot (M4.1); saving here changes nothing on the site by itself, and the page says so.
import { SettingRow, Switch } from "../../components/form.tsx";
import { type FieldErrors, orNull } from "../../lib/settings-form.ts";
import { type Built, ctl, GroupForm, type GroupSpec, RowError } from "./kit.tsx";

type Form = {
  dpdpReadinessPage: boolean;
  blogEnabled: boolean;
  weeklyDigest: boolean;
  calComUrl: string;
  whatsappNumber: string;
  ga4Id: string;
};

const spec: GroupSpec<"flags", Form> = {
  group: "flags",
  what: "the feature flags",
  savedText: "Feature flags saved. Website changes reach the site the next time it's published.",
  toForm: (v) => ({
    dpdpReadinessPage: v.dpdpReadinessPage,
    blogEnabled: v.blogEnabled,
    weeklyDigest: v.weeklyDigest,
    calComUrl: v.calComUrl ?? "",
    whatsappNumber: v.whatsappNumber ?? "",
    ga4Id: v.ga4Id ?? "",
  }),
  build: (f): Built<"flags"> => {
    const e: FieldErrors = {};
    const cal = orNull(f.calComUrl);
    if (cal && !/^https:\/\/\S+$/.test(cal))
      e["f-calComUrl"] = "Enter a full https:// address, or leave it empty.";
    const wa = orNull(f.whatsappNumber)?.replace(/[\s-]/g, "") ?? null;
    if (wa && !/^\+[1-9][0-9]{7,14}$/.test(wa))
      e["f-whatsappNumber"] = "Use the international format, e.g. +919800000000, or leave it empty.";
    const ga = orNull(f.ga4Id)?.toUpperCase() ?? null;
    if (ga && !/^G-[A-Z0-9]{6,12}$/.test(ga))
      e["f-ga4Id"] = "A Google Analytics 4 ID looks like G-XXXXXXXXXX. Leave it empty for no analytics.";
    if (Object.keys(e).length) return { errors: e };
    return {
      value: {
        dpdpReadinessPage: f.dpdpReadinessPage,
        blogEnabled: f.blogEnabled,
        weeklyDigest: f.weeklyDigest,
        calComUrl: cal,
        whatsappNumber: wa,
        ga4Id: ga,
      },
    };
  },
};

export function FeatureFlags() {
  return (
    <GroupForm spec={spec} readOnly={false}>
      {({ form: f, set, error }) => (
        <>
          <h2 className="settings-sub">Website</h2>
          <p className="hint">
            Website switches reach the site the next time it's published (milestone M4.1).
          </p>
          <div className="settings-rows">
            <SettingRow
              id="ff-s3"
              label="DPDP readiness page"
              description="Stays off until a legal partner is in place."
            >
              <Switch
                id="f-dpdpReadinessPage"
                labelledBy="ff-s3-label"
                describedBy="ff-s3-desc"
                checked={f.dpdpReadinessPage}
                onChange={(dpdpReadinessPage) => set({ dpdpReadinessPage })}
              />
            </SettingRow>
            <SettingRow id="ff-blog" label="Blog">
              <Switch
                id="f-blogEnabled"
                labelledBy="ff-blog-label"
                checked={f.blogEnabled}
                onChange={(blogEnabled) => set({ blogEnabled })}
              />
            </SettingRow>
            <SettingRow
              id="ff-cal"
              label="Cal.com booking link"
              labelFor="f-calComUrl"
              optional
              description="Empty hides the booking button."
            >
              <input
                {...ctl("f-calComUrl", error("f-calComUrl"), "ff-cal-desc")}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={f.calComUrl}
                onChange={(e) => set({ calComUrl: e.target.value })}
              />
              <RowError id="f-calComUrl" error={error("f-calComUrl")} />
            </SettingRow>
            <SettingRow
              id="ff-wa"
              label="WhatsApp number"
              labelFor="f-whatsappNumber"
              optional
              description="In the international format. Empty hides the WhatsApp link."
            >
              <input
                {...ctl("f-whatsappNumber", error("f-whatsappNumber"), "ff-wa-desc")}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={f.whatsappNumber}
                onChange={(e) => set({ whatsappNumber: e.target.value })}
              />
              <RowError id="f-whatsappNumber" error={error("f-whatsappNumber")} />
            </SettingRow>
            <SettingRow
              id="ff-ga"
              label="Google Analytics measurement ID"
              labelFor="f-ga4Id"
              optional
              description="Empty: no analytics, and the privacy policy leaves out the analytics lines."
            >
              <input
                {...ctl("f-ga4Id", error("f-ga4Id"), "ff-ga-desc")}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                value={f.ga4Id}
                onChange={(e) => set({ ga4Id: e.target.value })}
              />
              <RowError id="f-ga4Id" error={error("f-ga4Id")} />
            </SettingRow>
          </div>
          <h2 className="settings-sub">Admin</h2>
          <div className="settings-rows">
            <SettingRow
              id="ff-digest"
              label="Weekly digest email"
              description="A summary of the week, emailed to the owner."
            >
              <Switch
                id="f-weeklyDigest"
                labelledBy="ff-digest-label"
                describedBy="ff-digest-desc"
                checked={f.weeklyDigest}
                onChange={(weeklyDigest) => set({ weeklyDigest })}
              />
            </SettingRow>
          </div>
        </>
      )}
    </GroupForm>
  );
}
