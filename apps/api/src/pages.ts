/**
 * Marketing + legal pages served from the same Worker as the API.
 * Kept as plain HTML so we don't need a second deploy target for V1.
 */

export function landingHtml(origin: string): string {
  const mac = `${origin}/download/mac`;
  const win = `${origin}/download/windows`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HauntShot — Temporary screenshot sharing</title>
  <meta name="description" content="Capture a region, get a link, gone in 24 hours. Mac and Windows." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg0: #0c0b0a;
      --bg1: #161311;
      --ink: #f2ebe3;
      --muted: #a89f94;
      --accent: #e8a45c;
      --line: #2a2420;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "DM Sans", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #2a1c12 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #1a2228 0%, transparent 50%),
        linear-gradient(180deg, var(--bg1), var(--bg0));
      line-height: 1.5;
    }
    .wrap { max-width: 720px; margin: 0 auto; padding: 4.5rem 1.5rem 5rem; }
    .brand {
      font-family: "Fraunces", Georgia, serif;
      font-size: clamp(2.8rem, 8vw, 4.2rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      margin: 0 0 0.4rem;
      animation: rise 0.7s ease both;
    }
    h1 {
      font-family: "Fraunces", Georgia, serif;
      font-weight: 500;
      font-size: clamp(1.35rem, 3.5vw, 1.75rem);
      margin: 0 0 0.75rem;
      max-width: 18ch;
      animation: rise 0.7s 0.08s ease both;
    }
    .lead {
      color: var(--muted);
      font-size: 1.05rem;
      max-width: 34rem;
      margin: 0 0 2rem;
      animation: rise 0.7s 0.14s ease both;
    }
    .cta {
      display: flex; flex-wrap: wrap; gap: 0.75rem;
      margin-bottom: 3rem;
      animation: rise 0.7s 0.2s ease both;
    }
    a.btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0.7rem 1.15rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      border: 1px solid transparent;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    a.btn:hover { transform: translateY(-1px); }
    a.btn.primary { background: var(--accent); color: #1a120a; }
    a.btn.ghost { background: transparent; color: var(--ink); border-color: var(--line); }
    .grid {
      display: grid; gap: 1.25rem;
      border-top: 1px solid var(--line);
      padding-top: 2rem;
      animation: rise 0.7s 0.28s ease both;
    }
    .card h2 {
      font-family: "Fraunces", Georgia, serif;
      font-size: 1.15rem; font-weight: 500; margin: 0 0 0.35rem;
    }
    .card p { margin: 0; color: var(--muted); font-size: 0.95rem; }
    footer {
      margin-top: 3.5rem; padding-top: 1.25rem;
      border-top: 1px solid var(--line);
      display: flex; flex-wrap: wrap; gap: 1rem;
      font-size: 0.85rem; color: var(--muted);
    }
    footer a { color: var(--muted); }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: none; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <p class="brand">HauntShot</p>
    <h1>Capture. Share. Vanish.</h1>
    <p class="lead">
      Region select to a temporary link in one motion. Free for five captures a day.
      Links expire and are deleted after 24 hours. View only — no download button.
    </p>
    <div class="cta">
      <a class="btn primary" href="${mac}">Download for Mac</a>
      <a class="btn ghost" href="${win}">Download for Windows</a>
    </div>
    <section class="grid">
      <div class="card">
        <h2>24-hour TTL</h2>
        <p>Every shot dies on schedule. We purge the file, not just hide the link.</p>
      </div>
      <div class="card">
        <h2>Menubar, not another window</h2>
        <p>Lives in the tray. Hotkey on Mac and Windows. Clipboard gets the URL.</p>
      </div>
      <div class="card">
        <h2>HauntShot Pro · $4.99/mo or $29.99/yr</h2>
        <p>Unlimited captures. Upgrade from the app when you're ready.</p>
      </div>
    </section>
    <footer>
      <span>© HauntShot</span>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </footer>
  </main>
</body>
</html>`;
}

export function privacyHtml(): string {
  return legalPage(
    "Privacy",
    `
    <p>HauntShot stores screenshots you upload so recipients can view them.</p>
    <ul>
      <li>Images and metadata are kept for up to 24 hours, then deleted from our storage.</li>
      <li>We identify free-tier usage with a device id generated on your computer. Paid accounts use an email you provide.</li>
      <li>We use Stripe to process payments; card details never touch our servers.</li>
      <li>Viewer links are not end-to-end encrypted. Do not upload secrets you cannot risk exposing.</li>
      <li>Contact: privacy@hauntshot.com</li>
    </ul>`,
  );
}

export function termsHtml(): string {
  return legalPage(
    "Terms",
    `
    <p>By using HauntShot you agree to these terms.</p>
    <ul>
      <li>The service is provided as-is. Links and files may fail; do not rely on HauntShot for archives.</li>
      <li>You are responsible for what you upload. No illegal content, malware, or abuse of others.</li>
      <li>Free tier is limited (five captures per UTC day). Paid plans remove that cap while your subscription is active.</li>
      <li>We may suspend accounts that abuse the service or attempt to bypass limits.</li>
      <li>Subscriptions renew until cancelled. Manage billing through the Stripe customer portal linked from the app.</li>
    </ul>`,
  );
}

function legalPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · HauntShot</title>
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#111; color:#eee;
      line-height:1.55; }
    main { max-width: 40rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
    a { color:#c9b8a0; }
    h1 { font-size: 1.6rem; }
    ul { padding-left: 1.2rem; color:#bbb; }
    li { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <main>
    <p><a href="/">← HauntShot</a></p>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;
}
