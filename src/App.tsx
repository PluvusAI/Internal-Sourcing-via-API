import { ClerkProvider, OrganizationSwitcher, SignIn, UserButton, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, setTokenGetter, type SessionConfig } from "./api";
import { Notice, Spinner } from "./components/ui";
import { ListPage } from "./pages/ListPage";
import { useMeta } from "./meta";
import { ListsHome } from "./pages/ListsHome";
import { linkHandler, useLocation } from "./router";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export function App() {
  const cfg = useQuery({ queryKey: ["session-config"], queryFn: api.sessionConfig, staleTime: Infinity, retry: 1 });
  if (cfg.isLoading) return <Centered><Spinner label="Loading" /></Centered>;
  if (cfg.isError) return <Centered><Notice tone="danger" title="The app server could not be reached">{cfg.error.message}</Notice></Centered>;
  const c = cfg.data!;
  if (c.setupProblems.length > 0) return <SetupRequired problems={c.setupProblems} />;
  if (c.authMode === "dev") return <Shell config={c} account={<span className="badge badge-warning">Development sign-in</span>} />;
  if (!PUBLISHABLE_KEY) return <SetupRequired problems={["VITE_CLERK_PUBLISHABLE_KEY was not set when this app was built"]} />;
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <ClerkGate config={c} />
    </ClerkProvider>
  );
}

function ClerkGate({ config }: { config: SessionConfig }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState<{ kind: "checking" } | { kind: "ok" } | { kind: "denied"; code: string; message: string }>({ kind: "checking" });
  useEffect(() => {
    if (!isSignedIn) return;
    setTokenGetter(async () => (await getToken()) ?? null);
    let live = true;
    setState({ kind: "checking" });
    api
      .session()
      .then(() => live && setState({ kind: "ok" }))
      .catch((err: unknown) => live && setState({ kind: "denied", code: err instanceof ApiError ? err.code : "error", message: err instanceof Error ? err.message : "Access check failed." }));
    return () => {
      live = false;
    };
  }, [isSignedIn, getToken]);

  if (!isLoaded) return <Centered><Spinner label="Loading sign-in" /></Centered>;
  if (!isSignedIn) {
    return (
      <Centered>
        <SignIn routing="hash" withSignUp={false} />
      </Centered>
    );
  }
  if (state.kind === "checking") return <Centered><Spinner label="Checking access" /></Centered>;
  if (state.kind === "denied") {
    return (
      <Centered>
        <div className="stack" style={{ maxWidth: 480 }}>
          <Notice tone="danger" title="Access not granted">
            {state.message}
          </Notice>
          {state.code === "organization_required" || state.code === "not_allowed" ? <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" /> : null}
          <UserButton />
        </div>
      </Centered>
    );
  }
  return <Shell config={config} account={<><OrganizationSwitcher hidePersonal /><UserButton /></>} />;
}

/** Codes the app's server uses when its connection to the sourcing service is misconfigured. */
const SOURCE_SETUP_CODES = new Set(["source_auth_failed", "source_not_configured", "source_misconfigured", "setup_required"]);

function Shell({ config, account }: { config: SessionConfig; account: ReactNode }) {
  const { route } = useLocation();
  // The same metadata read the forms use; a setup failure here explains every empty screen below.
  const meta = useMeta();
  const setupError = meta.error instanceof ApiError && SOURCE_SETUP_CODES.has(meta.error.code) ? meta.error : null;
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="brand" onClick={linkHandler("/")}>
          <span className="brand-mark" aria-hidden>
            P
          </span>
          Creator sourcing
        </a>
        <span className="topbar-spacer" />
        {account}
      </header>
      {config.sourceMode === "mock" ? (
        <div className="mode-banner" role="status">
          Sample data — this app is running in development mock mode, not connected to the sourcing service. Nothing here is real.
        </div>
      ) : null}
      {setupError ? (
        <div className="mode-banner setup-banner" role="alert">
          Not connected to the sourcing service: {setupError.message}
        </div>
      ) : null}
      <main className="main">{route.name === "list" ? <ListPage key={route.id} id={route.id} /> : <ListsHome />}</main>
    </div>
  );
}

function SetupRequired({ problems }: { problems: string[] }) {
  return (
    <Centered>
      <div className="card card-pad stack" style={{ maxWidth: 620 }}>
        <h1>Setup required</h1>
        <p className="muted">This app is not connected yet, so it shows no data. An administrator needs to set:</p>
        <ul>
          {problems.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
        <p className="muted small">See the README’s “Configuration” section. Values are never shown here.</p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>{children}</div>;
}
