// The client portal's frame (M4.5; POR-02, POR-04, POR-10): an ink band with the lockup and the client's account, the
// five sections under it, the content, and a quiet footer. The band is ink in both themes (as the admin's rail), so the
// lockup is always its on-dark version. The current section is marked with aria-current, bold text and a verdigris bar
// whose end carries the mark's 45° cut (docs/06 §4.3). Below md the sections move into a full-screen menu (docs/06 §4.2).
import "../../portal.css";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import symbolColor from "@techaust/ui/brand/logo-symbol-color.svg?url";
import symbolDark from "@techaust/ui/brand/logo-symbol-dark.svg?url";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { DOC_TITLE_SUFFIX, PRODUCT } from "../../copy.ts";
import { WORDS } from "../../copy-documents.ts";
import { AccountMenu, type AccountProps, MobileMenu } from "./account-menu.tsx";
import { NAV, type NavKey } from "./nav.tsx";

export type { NavKey };

export function PortalShell(props: {
  current: NavKey | null;
  hrefOf: (key: NavKey) => string;
  account: AccountProps;
  /** Preview only: open the account panel on arrival (for its screenshot). */
  accountOpen?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="pshell">
      <SkipLink />
      <header className="pbar">
        <div className="pbar__row">
          <Link to={props.hrefOf("home")} className="pbar__brand">
            <img
              src={logoDark}
              alt={`TecHaust Technologies ${PRODUCT.toLowerCase()}, home`}
              width="200"
              height="28"
            />
            <span className="pbar__product" aria-hidden="true">
              {PRODUCT}
            </span>
          </Link>
          <div className="pbar__end">
            <AccountMenu {...props.account} defaultOpen={props.accountOpen} />
            <MobileMenu {...props.account} current={props.current} hrefOf={props.hrefOf} />
          </div>
        </div>
        <nav className="pnav" aria-label="Portal">
          <ul className="pnav__list">
            {NAV.map((item) => (
              <li key={item.key}>
                <Link
                  to={props.hrefOf(item.key)}
                  className="pnav__link"
                  aria-current={props.current === item.key ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="pmain" tabIndex={-1}>
        {props.children}
      </main>
      <PortalFooter />
    </div>
  );
}

function SkipLink() {
  return (
    // biome-ignore lint/a11y/useValidAnchor: a real link to #main (works without script); the click only skips the hash change
    <a
      className="skip-link"
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
    >
      {WORDS.skip}
    </a>
  );
}

/** The quiet footer: the symbol and the company line (07 §8). */
export function PortalFooter() {
  return (
    <footer className="pfoot">
      <div className="pfoot__inner">
        <picture>
          <source srcSet={symbolDark} media="(prefers-color-scheme: dark)" />
          <img src={symbolColor} alt="" width="20" height="20" className="pfoot__mark" />
        </picture>
        <p>{WORDS.footer}</p>
      </div>
    </footer>
  );
}

/**
 * The frame for a single document opened from an email link without signing in (POR-06): the band with the lockup and a
 * way to sign in; no sections and no account.
 */
export function TokenShell(props: { signInHref: string; children: ReactNode }) {
  return (
    <div className="pshell">
      <SkipLink />
      <header className="pbar pbar--slim">
        <div className="pbar__row">
          <span className="pbar__brand">
            <img src={logoDark} alt="TecHaust Technologies" width="200" height="28" />
            <span className="pbar__product">{PRODUCT}</span>
          </span>
          <div className="pbar__end">
            <Link to={props.signInHref} className="pbar__signin">
              {WORDS.signIn}
            </Link>
          </div>
        </div>
      </header>
      <main id="main" className="pmain" tabIndex={-1}>
        {props.children}
      </main>
      <PortalFooter />
    </div>
  );
}

/**
 * A screen's one h1. After the first screen of a visit, a new path moves focus here, so keyboard and screen-reader users
 * start at the top of what changed (as the admin's PageHeader). The tab title follows it (WCAG 2.4.2).
 */
export function PageTitle(props: {
  children: ReactNode;
  text: string;
  className?: string | undefined;
  id?: string | undefined;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const { key, pathname } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the path changes, not on every query change
  useEffect(() => {
    if (key !== "default") h1.current?.focus();
  }, [pathname]);
  useEffect(() => {
    document.title = `${props.text} – ${DOC_TITLE_SUFFIX}`;
  }, [props.text]);
  return (
    <h1 ref={h1} tabIndex={-1} className={props.className} id={props.id}>
      {props.children}
    </h1>
  );
}
