import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ListShotsResponse,
  ShotSummary,
  QuotaStatus,
} from "@hauntshot/shared";
import { DEFAULT_HOTKEY, FREE_LIVE_LIMIT } from "@hauntshot/shared";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE?.toString() || "http://127.0.0.1:8787";

function remainingLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m left`;
}

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [shots, setShots] = useState<ShotSummary[]>([]);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>(`Hotkey: ${DEFAULT_HOTKEY}`);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!deviceId) throw new Error("No device id");
      return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          "X-HauntShot-Device-Id": deviceId,
        },
      });
    },
    [deviceId],
  );

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    setError("");
    try {
      const res = await api("/v1/shots");
      if (!res.ok) {
        setError(`Failed to load shots (${res.status})`);
        return;
      }
      const data = (await res.json()) as ListShotsResponse;
      setShots(data.shots);
      setQuota(data.quota);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "API unreachable — start apps/api (`npm run dev:api`)",
      );
    }
  }, [api, deviceId]);

  useEffect(() => {
    invoke<string>("get_device_id")
      .then(setDeviceId)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (deviceId) void refresh();
  }, [deviceId, refresh]);

  // Keyed on the ids themselves so a refresh returning the same shots is a no-op.
  const shotIds = shots.map((s) => s.id).join(",");
  useEffect(() => {
    const ids = shotIds ? shotIds.split(",") : [];
    if (ids.length === 0) {
      setThumbs({});
      return;
    }
    let cancelled = false;
    invoke<Record<string, string>>("shot_thumbnails", { ids })
      .then((found) => {
        if (!cancelled) setThumbs(found);
      })
      .catch(() => {
        // A missing preview is not worth interrupting the list for.
      });
    return () => {
      cancelled = true;
    };
  }, [shotIds]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") void getCurrentWindow().hide();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const unsubs = [
      listen("panel-shown", () => {
        void refresh();
      }),
      listen<string>("share-status", (e) => {
        setBusy(true);
        setStatus(e.payload);
        setError("");
      }),
      listen<{ viewerUrl: string }>("share-success", (e) => {
        setBusy(false);
        setStatus(`Link copied · ${e.payload.viewerUrl}`);
        setError("");
        void refresh();
      }),
      listen<{ message: string; code: string }>("share-failed", (e) => {
        setBusy(false);
        if (e.payload.code === "quota_exceeded") {
          setError(e.payload.message);
          setStatus("");
        } else {
          setError(e.payload.message);
          setStatus("Couldn’t upload — link was not copied");
        }
      }),
    ];
    return () => {
      void Promise.all(unsubs).then((fns) => fns.forEach((u) => u()));
    };
  }, [refresh]);

  async function capture() {
    setBusy(true);
    setError("");
    setStatus("Select a region…");
    try {
      const result = await invoke<{ viewerUrl: string }>("capture_and_share");
      setStatus(`Link copied · ${result.viewerUrl}`);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "cancelled" || msg.includes("cancelled")) {
        setStatus("Capture cancelled");
      } else if (msg === "busy") {
        setStatus("Capture already in progress");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(shot: ShotSummary) {
    const url = shot.viewerUrl ?? `${API_BASE}${shot.viewerPath}`;
    try {
      await invoke("copy_link", { url });
      setError("");
      setStatus(`Link copied · ${url}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const liveLabel =
    quota?.liveLimit == null
      ? `Paid · ${quota?.liveCount ?? 0} live`
      : `Free · ${quota?.liveCount ?? 0}/${FREE_LIVE_LIMIT} live`;

  return (
    <main className="shell">
      <header className="header">
        <strong>HauntShot</strong>
        <span className="quota">{liveLabel}</span>
      </header>

      <p className="hint">
        Unexpired captures only. {DEFAULT_HOTKEY} or Capture → upload → link on
        clipboard. Esc hides this panel.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {status ? <p className="status">{status}</p> : null}

      <section className="list">
        {shots.length === 0 ? (
          <p className="empty">No live screenshots — capture to share</p>
        ) : (
          shots.map((shot) => (
            <div className="row" key={shot.id}>
              {thumbs[shot.id] ? (
                <img className="thumb" src={thumbs[shot.id]} alt="" />
              ) : (
                <div className="thumb empty-thumb" aria-hidden="true" />
              )}
              <div className="meta">
                <div className="ttl">{remainingLabel(shot.expiresAt)}</div>
                <div className="url">{shot.viewerPath}</div>
              </div>
              <button type="button" onClick={() => void copyLink(shot)}>
                Copy link
              </button>
            </div>
          ))
        )}
      </section>

      <footer className="footer">
        <button type="button" disabled={busy} onClick={() => void capture()}>
          {busy ? "Working…" : "Capture"}
        </button>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
        <span className="muted">{API_BASE}</span>
      </footer>
    </main>
  );
}
