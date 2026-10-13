// Demo build only: a small pill so visitors know the data is sample data and can switch login.
export function DemoBanner() {
  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur md:bottom-4 print:hidden">
      Demo · sample data, resets nightly ·{" "}
      <a href="/demo" className="font-medium text-foreground underline-offset-2 hover:underline">
        Switch login
      </a>
    </div>
  );
}
