import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { ADVISORY } from "@/lib/utils";

const InspectorApp = lazy(() =>
  import("@/components/inspector/InspectorApp").then((mod) => ({ default: mod.InspectorApp })),
);

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <Boot />;
  return (
    <Suspense fallback={<Boot />}>
      <InspectorApp />
    </Suspense>
  );
}

function Boot() {
  return (
    <main className="flex min-h-dvh flex-col bg-bg px-4 py-6 text-fg">
      <p className="text-sm font-semibold tracking-wide">Northline</p>
      <h1 className="mt-2 text-xl font-semibold">G-code inspector</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
        Local parse, 3D toolpath, and time estimate. Nothing is sent to a server.
      </p>
      <p className="mt-4 max-w-2xl text-xs leading-5 text-muted">{ADVISORY}</p>
    </main>
  );
}
