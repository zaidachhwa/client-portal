// Loading placeholders that match the real layout, so content fills in without anything jumping.
// Only the dynamic parts are placeholders; real headings are passed in where they're known up front.
const bar = "rounded-full bg-ink/[0.07] motion-safe:animate-pulse";
const card = "glass rounded-[28px] p-5";

function Lines({ widths }: { widths: string[] }) {
  return <div className="space-y-2.5">{widths.map((w, i) => <div key={i} className={`h-3 ${bar}`} style={{ width: w }} />)}</div>;
}

function CardSkeleton({ className = "", lines = ["40%", "85%", "70%", "90%"] }: { className?: string; lines?: string[] }) {
  return (
    <div className={`${card} ${className}`}>
      <div className={`mb-5 h-4 w-1/3 ${bar}`} />
      <Lines widths={lines} />
    </div>
  );
}

// Sidebar while the session loads (only on a full page load; afterwards it stays mounted).
export function SidebarSkeleton() {
  return (
    <div aria-hidden className="sticky top-0 z-10 flex h-dvh w-16 shrink-0 flex-col items-center gap-2 border-r border-white/60 bg-white/30 py-5 backdrop-blur-xl sm:w-[72px]">
      <svg viewBox="0 0 24 24" className="mb-6 size-7 text-ink">
        <path fill="currentColor" d="M12 1c.6 5.6 2.4 8.4 11 11-8.6 2.6-10.4 5.4-11 11-.6-5.6-2.4-8.4-11-11 8.6-2.6 10.4-5.4 11-11Z" />
      </svg>
      {[0, 1, 2, 3, 4].map((i) => <div key={i} className="grid size-11 place-items-center"><div className={`size-5 rounded-md ${bar}`} /></div>)}
      <div className="mt-auto grid size-11 place-items-center"><div className={`size-5 rounded-md ${bar}`} /></div>
      <div className={`mt-1 size-[42px] ${bar}`} />
    </div>
  );
}

// The overview's two columns, with the same grid as the dashboard.
export function OverviewSkeleton() {
  return (
    <main aria-busy="true" aria-label="Loading" className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-5">
      <div className="flex flex-col gap-5">
        <div className="px-1 pt-3 lg:pt-8">
          <div className={`h-3 w-3/4 ${bar}`} />
          <div className={`mt-4 h-8 w-1/2 ${bar}`} />
          <div className={`mt-2 h-8 w-2/3 ${bar}`} />
          <div className={`mt-5 h-11 w-full ${bar}`} />
        </div>
        <CardSkeleton lines={["70%", "100%", "60%", "100%"]} />
        <CardSkeleton lines={["55%", "80%", "65%"]} />
        <CardSkeleton lines={["90%", "75%", "85%"]} />
      </div>
      <div className="@container">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:grid-cols-2 lg:gap-5">
          <CardSkeleton className="h-[380px] @3xl:col-span-2" lines={["60%", "90%", "75%", "85%", "70%"]} />
          <CardSkeleton className="h-[540px]" lines={["50%", "80%", "65%", "75%"]} />
          <CardSkeleton className="h-[540px]" lines={["70%", "90%", "80%", "60%"]} />
        </div>
      </div>
    </main>
  );
}

// Section pages (Calendar, Files, Chat, Billing): the real title stays, the rest loads.
export function SectionSkeleton({ title }: { title: string }) {
  return (
    <main aria-busy="true" aria-label={`Loading ${title}`} className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1 pt-3 lg:pt-4">
        <div>
          <h1 className="text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">{title}</h1>
          <div className={`mt-2 h-3 w-48 ${bar}`} />
        </div>
        <div className={`h-9 w-56 ${bar}`} />
      </header>
      <CardSkeleton className="min-h-[60dvh]" lines={["40%", "90%", "75%", "85%", "60%", "80%"]} />
    </main>
  );
}
