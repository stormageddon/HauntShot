/**
 * Resolve download / updater assets from the latest GitHub Release.
 * Branded URLs on hauntshot.com stay stable; binaries live on Releases.
 */

const REPO = "stormageddon/HauntShot";
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "HauntShot",
} as const;

type GhAsset = {
  name: string;
  browser_download_url: string;
};

type GhRelease = {
  tag_name?: string;
  assets?: GhAsset[];
};

async function latestRelease(): Promise<GhRelease | null> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: GH_HEADERS },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as GhRelease;
}

function pickAsset(
  assets: GhAsset[],
  prefer: (name: string) => number,
): GhAsset | null {
  let best: GhAsset | null = null;
  let bestScore = -1;
  for (const a of assets) {
    const score = prefer(a.name.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return bestScore >= 0 ? best : null;
}

/** Prefer universal DMG, then any DMG, then .app.tar.gz. */
export async function macDownloadUrl(): Promise<string | null> {
  const release = await latestRelease();
  if (!release?.assets?.length) return null;
  const asset = pickAsset(release.assets, (n) => {
    if (n.endsWith(".dmg") && n.includes("universal")) return 100;
    if (n.endsWith(".dmg") && n.includes("aarch64")) return 90;
    if (n.endsWith(".dmg")) return 80;
    if (n.endsWith(".app.tar.gz")) return 40;
    return -1;
  });
  return asset?.browser_download_url ?? null;
}

/** Prefer NSIS setup.exe, then MSI. */
export async function windowsDownloadUrl(): Promise<string | null> {
  const release = await latestRelease();
  if (!release?.assets?.length) return null;
  const asset = pickAsset(release.assets, (n) => {
    if (n.endsWith("-setup.exe") || (n.endsWith(".exe") && n.includes("setup")))
      return 100;
    if (n.endsWith(".exe") && !n.endsWith(".sig")) return 80;
    if (n.endsWith(".msi")) return 60;
    return -1;
  });
  return asset?.browser_download_url ?? null;
}

/** Fallback when no GitHub Release exists yet. */
export const DOWNLOAD_FALLBACK = {
  mac: `https://github.com/${REPO}/releases`,
  windows: `https://github.com/${REPO}/releases`,
} as const;

const LATEST_JSON_URL = `https://github.com/${REPO}/releases/latest/download/latest.json`;

/** Proxy Tauri updater manifest so hauntshot.com is the primary endpoint. */
export async function fetchUpdaterManifest(): Promise<Response> {
  return fetch(LATEST_JSON_URL, {
    headers: { "User-Agent": "HauntShot", Accept: "application/json" },
    redirect: "follow",
  });
}
