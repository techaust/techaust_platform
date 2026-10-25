// The dashboard (M3.5, ADM-DASH-01): the tiles GET /dashboard returns for this role, exactly as returned. A tile the role may not
// see is absent from the answer and so from the page (Sales: the pipeline; the accountant: finance; staff: delivery and their own
// time; the owner: all). Figures are live. The figures that arrive with later modules (pipeline value, invoiced and collected)
// say so in the 07-M words instead of showing a zero. Care plan hours are a calm bar per plan with the 80 % and 100 % flags; recent
// activity is in words, never the audit summary. Phone: one column of cards, in reading order.
import "./care/parts.tsx";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { api, type Dashboard as DashboardData, type DashboardTiles } from "../api.ts";
import { PageHeader, Skeleton, When } from "../components/display.tsx";
import { FileText, Receipt, Wallet } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { CARE_COPY, dayText, hoursText } from "../lib/care.ts";
import { activityHref, activityText, DASH_COPY, showingFirst, TILE_TITLES } from "../lib/dashboard.ts";
import { STAGE_LABELS, STAGES } from "../lib/leads.ts";
import { useUser } from "../session.tsx";
import { FlagPill, HoursBar, tierText } from "./care/parts.tsx";
import { MilestonePill } from "./projects/parts.tsx";

export function Dashboard() {
  const page = useLoad(() => api.dashboard(), "");
  return (
    <>
      <PageHeader title="Dashboard" />
      {page.state === "failed" ? (
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      ) : page.state === "loading" ? (
        <DashSkeleton />
      ) : (
        <Tiles data={page.data} />
      )}
    </>
  );
}

function Tiles({ data }: { data: DashboardData }) {
  const t = data.tiles;
  const kpis = [
    t.leads && <LeadsTile key="leads" tile={t.leads} />,
    t.projects && <ProjectsTile key="projects" tile={t.projects} />,
    t.myTime && <MyTimeTile key="myTime" tile={t.myTime} />,
  ].filter(Boolean);
  // Two or more figure tiles run across the top; a single one (Sales: leads) heads the main column instead.
  const strip =
    kpis.length > 0 ? (
      <div className="dash__kpis" data-count={kpis.length}>
        {kpis}
      </div>
    ) : null;
  return (
    <div className="dash">
      {kpis.length > 1 && strip}
      <div className="dash__main">
        {kpis.length === 1 && strip}
        {t.careBurn && <CareTile tile={t.careBurn} />}
        {t.activity && <ActivityTile tile={t.activity} />}
      </div>
      {(t.milestones || t.pipelineValue || t.finance) && (
        <div className="dash__side">
          {t.milestones && <MilestonesTile tile={t.milestones} today={data.today} />}
          {t.pipelineValue && (
            <Tile id="pipeline" title={TILE_TITLES.pipelineValue} quiet>
              <p className="panel-empty">
                <FileText size={20} />
                <span>{DASH_COPY.pipelineArrives}</span>
              </p>
            </Tile>
          )}
          {t.finance && (
            <Tile id="finance" title={TILE_TITLES.finance} quiet>
              <p className="panel-empty">
                <Receipt size={20} />
                <span>{DASH_COPY.financeArrives}</span>
              </p>
              <p className="panel-empty">
                <Wallet size={20} />
                <span>{DASH_COPY.paymentsArrive}</span>
              </p>
            </Tile>
          )}
        </div>
      )}
    </div>
  );
}

/** A tile: a panel with its h2 and, when it leads somewhere, one link in the head. */
function Tile(props: {
  id: string;
  title: string;
  link?: { to: string; text: string; hidden?: string } | undefined;
  quiet?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`lead-panel tile${props.quiet ? " tile--quiet" : ""}${props.className ? ` ${props.className}` : ""}`}
      aria-labelledby={`tile-${props.id}`}
    >
      <div className="lead-panel__head tile__head">
        <h2 id={`tile-${props.id}`} className="lead-panel__title">
          {props.title}
        </h2>
        {props.link && (
          <Link to={props.link.to} className="tile__link">
            {props.link.text}
            {props.link.hidden && <span className="visually-hidden"> {props.link.hidden}</span>}
          </Link>
        )}
      </div>
      {props.children}
    </section>
  );
}

/** The one big figure of a tile, with its label underneath (tabular). */
function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <p className="figure">
      <span className="figure__value tnum">{value}</span>
      <span className="figure__label">{label}</span>
    </p>
  );
}

// ---- leads (owner, Sales) -----------------------------------------------------------------------------------------------------

function LeadsTile({ tile }: { tile: NonNullable<DashboardTiles["leads"]> }) {
  const stages = STAGES.filter((s) => s !== "won" && s !== "lost");
  return (
    <Tile id="leads" title={TILE_TITLES.leads} link={{ to: "/leads", text: "Open leads" }}>
      {tile.open === 0 ? (
        <p className="muted">{DASH_COPY.noLeads}</p>
      ) : (
        <>
          <Figure value={tile.open} label="Open" />
          <dl className="mini-facts">
            {stages.map((s) => (
              <div key={s}>
                <dt>{STAGE_LABELS[s]}</dt>
                <dd className="tnum">{tile.openByStage[s] ?? 0}</dd>
              </div>
            ))}
            <div>
              <dt>New in the last 7 days</dt>
              <dd className="tnum">{tile.newLast7Days}</dd>
            </div>
            <div data-alert={tile.overdue.count > 0 || undefined}>
              <dt>Overdue next actions</dt>
              <dd className="tnum">{tile.overdue.count}</dd>
            </div>
          </dl>
          {tile.overdue.oldest.length > 0 && (
            <ul className="tile-list tile-list--compact" aria-label="Oldest overdue next actions">
              {tile.overdue.oldest.map((l) => (
                <li key={l.id}>
                  <Link to={`/leads/${l.id}`} className="tile-list__main">
                    <span className="docno">{l.ref}</span> {l.contactName}
                  </Link>
                  <When ms={l.dueAt} inline />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Tile>
  );
}

// ---- projects and milestones (owner, staff) -----------------------------------------------------------------------------------

function ProjectsTile({ tile }: { tile: NonNullable<DashboardTiles["projects"]> }) {
  return (
    <Tile
      id="projects"
      title={TILE_TITLES.projects}
      link={{ to: "/projects?status=active", text: "Open projects" }}
    >
      <Figure value={tile.active} label="Active" />
      <dl className="mini-facts">
        <div>
          <dt>On hold</dt>
          <dd className="tnum">{tile.onHold}</dd>
        </div>
      </dl>
    </Tile>
  );
}

function MilestonesTile({ tile, today }: { tile: NonNullable<DashboardTiles["milestones"]>; today: string }) {
  return (
    <Tile id="milestones" title={TILE_TITLES.milestones} className="tile--milestones">
      {tile.count === 0 ? (
        <p className="muted">{DASH_COPY.noMilestones}</p>
      ) : (
        <>
          <ol className="tile-list">
            {tile.next.map((m) => (
              <li key={m.id} className="tile-list__item">
                <span className="tile-list__text">
                  <Link to={`/projects/${m.projectId}?tab=milestones`} className="tile-list__main">
                    {m.title}
                  </Link>
                  <span className="tile-list__meta">
                    {m.projectCode && <span className="docno">{m.projectCode}</span>}
                    <time dateTime={m.dueDate} data-today={m.dueDate === today || undefined}>
                      {dayText(m.dueDate)}
                    </time>
                  </span>
                </span>
                <MilestonePill status={m.status} />
              </li>
            ))}
          </ol>
          {tile.count > tile.next.length && (
            <p className="hint tile__more">{showingFirst(tile.next.length)}</p>
          )}
        </>
      )}
    </Tile>
  );
}

// ---- care plan hours (owner, staff) -------------------------------------------------------------------------------------------

function CareTile({ tile }: { tile: NonNullable<DashboardTiles["careBurn"]> }) {
  const c = tile.counts;
  return (
    <Tile
      id="care"
      title={TILE_TITLES.careBurn}
      link={{ to: "/care-plans?status=active", text: "Open care plans" }}
      className="tile--care"
    >
      {c.active === 0 && c.notStarted === 0 ? (
        <p className="muted">{DASH_COPY.noCarePlans}</p>
      ) : (
        <>
          <dl className="mini-facts mini-facts--row">
            <div>
              <dt>Active</dt>
              <dd className="tnum">{c.active}</dd>
            </div>
            <div data-tone={c.near > 0 ? "near" : undefined}>
              <dt>{CARE_COPY.near}</dt>
              <dd className="tnum">{c.near}</dd>
            </div>
            <div data-tone={c.reached > 0 ? "reached" : undefined}>
              <dt>{CARE_COPY.reached}</dt>
              <dd className="tnum">{c.reached}</dd>
            </div>
            {c.notStarted > 0 && (
              <div>
                <dt>{DASH_COPY.notStarted}</dt>
                <dd className="tnum">{c.notStarted}</dd>
              </div>
            )}
          </dl>
          {tile.rows.length > 0 && (
            <ul className="burn-list">
              {tile.rows.map((r) => (
                <li key={r.planId} className="burn-row">
                  <div className="burn-row__who">
                    <Link to={`/care-plans/${r.planId}`} className="tile-list__main">
                      {r.clientName}
                    </Link>
                    <span className="tile-list__meta">
                      <span className="docno">{r.clientCode}</span>
                      <span>{tierText(r.tier)}</span>
                    </span>
                  </div>
                  <div className="burn-row__hours">
                    <HoursBar usage={r} label={r.clientName} />
                    <FlagPill flag={r.flag} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(tile.truncated || c.active > tile.rows.length) && (
            <p className="hint tile__more">{showingFirst(tile.rows.length)}</p>
          )}
        </>
      )}
    </Tile>
  );
}

// ---- my time (owner, staff) ---------------------------------------------------------------------------------------------------

function MyTimeTile({ tile }: { tile: NonNullable<DashboardTiles["myTime"]> }) {
  const user = useUser();
  return (
    <Tile
      id="mytime"
      title={TILE_TITLES.myTime}
      link={allowed(user.role, "time.writeOwn") ? { to: "/time?log=1", text: "Log time" } : undefined}
    >
      {tile.week.minutes === 0 ? (
        <p className="muted">{DASH_COPY.noTime}</p>
      ) : (
        <>
          <Figure value={hoursText(tile.week.minutes)} label="This week" />
          <dl className="mini-facts">
            <div>
              <dt>Billable this week</dt>
              <dd className="tnum">{hoursText(tile.week.billableMinutes)}</dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd className="tnum">{hoursText(tile.today.minutes)}</dd>
            </div>
          </dl>
        </>
      )}
    </Tile>
  );
}

// ---- recent activity (every role) ------------------------------------------------------------------------------------------------

function ActivityTile({ tile }: { tile: NonNullable<DashboardTiles["activity"]> }) {
  return (
    <Tile id="activity" title={TILE_TITLES.activity} className="tile--activity">
      {tile.items.length === 0 ? (
        <p className="muted">{DASH_COPY.noActivity}</p>
      ) : (
        <ol className="activity-list">
          {tile.items.map((a) => {
            const href = activityHref(a.entityType, a.entityId);
            return (
              <li key={a.id} className="activity-item">
                <p className="activity-item__text">
                  <span className="activity-item__who">
                    {a.actor === "System" ? DASH_COPY.system : a.actor}
                  </span>{" "}
                  {activityText(a.action)}
                  {a.ref &&
                    (href ? (
                      <>
                        {" "}
                        <Link to={href} className="docno activity-item__ref">
                          {a.ref}
                        </Link>
                      </>
                    ) : (
                      <>
                        {" "}
                        <span className="docno">{a.ref}</span>
                      </>
                    ))}
                </p>
                <When ms={a.at} inline />
              </li>
            );
          })}
        </ol>
      )}
    </Tile>
  );
}

function DashSkeleton() {
  return (
    <>
      <p className="visually-hidden" role="status">
        Loading the dashboard
      </p>
      <DashSkeletonTiles />
    </>
  );
}

function DashSkeletonTiles() {
  return (
    <div className="dash" aria-hidden="true">
      <div className="dash__kpis" data-count={3}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="lead-panel stack-sm">
            <Skeleton width="40%" />
            <Skeleton width="30%" />
            <Skeleton width="70%" />
          </div>
        ))}
      </div>
      <div className="dash__main">
        <div className="lead-panel stack-sm tile--care">
          <Skeleton width="30%" />
          <Skeleton width="100%" />
          <Skeleton width="100%" />
        </div>
      </div>
    </div>
  );
}
