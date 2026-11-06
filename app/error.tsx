"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

// Fallback for anything that throws while rendering a page. In development Next still shows its overlay first.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const offline = error instanceof TypeError && /fetch|network/i.test(error.message);

  return (
    <main className="mesh grid min-h-dvh place-items-center p-4">
      <div className="glass w-full max-w-sm rounded-[28px] p-7 text-center">
        <h1 className="text-[22px] tracking-[-0.01em]">{offline ? "Lost connection" : "Something went wrong"}</h1>
        <p className="mt-2 text-[13px] text-muted">
          {offline ? "The server couldn't be reached. Check your connection; nothing you saved is lost." : "This page hit an error. Trying again usually fixes it."}
        </p>
        <button onClick={() => retry()} className="press mt-5 rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
