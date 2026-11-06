import "server-only";

// Transactional email through Resend's REST API (one POST; no SDK needed).
// Without RESEND_API_KEY the message is logged instead, so local dev still works.
const FROM = process.env.MAIL_FROM ?? "Zenova Client Portal <onboarding@resend.dev>";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendMail(to: string, subject: string, lines: string[], cta?: { label: string; url: string }) {
  const text = [...lines, cta ? `${cta.label}: ${cta.url}` : ""].filter(Boolean).join("\n\n");
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
    return { sent: false as const, reason: "RESEND_API_KEY is not set" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html: layout(lines, cta) }),
  });
  if (!res.ok) {
    console.error(`[mail] Resend ${res.status}: ${await res.text()}`);
    return { sent: false as const, reason: `Resend returned ${res.status}` };
  }
  return { sent: true as const };
}

// Same palette as the app: warm paper background, ink text, ink pill button.
function layout(lines: string[], cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#fbf8f6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b2131">
<div style="max-width:480px;margin:0 auto;padding:40px 24px">
  <div style="font-size:22px;margin-bottom:24px">✦</div>
  ${lines.map((l) => `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${esc(l)}</p>`).join("")}
  ${cta ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#1b2131;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px">${esc(cta.label)}</a></p>
  <p style="font-size:12px;color:#777a88;word-break:break-all">${esc(cta.url)}</p>` : ""}
</div></body></html>`;
}
