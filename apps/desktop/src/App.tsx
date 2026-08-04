import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ListShotsResponse,
  ShotSummary,
  QuotaStatus,
} from "@hauntshot/shared";
import { DEFAULT_HOTKEY, FREE_DAILY_LIMIT } from "@hauntshot/shared";
import Settings from "./Settings";
import { CaptureIcon, GearIcon } from "./icons";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_API_BASE?.toString() || "http://127.0.0.1:8787";

/** Short enough that a minute-resolution countdown never looks wrong. */
const REFRESH_INTERVAL_MS = 30_000;

const IDLE_STATUS = `Hotkey: ${DEFAULT_HOTKEY}`;

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [status, setStatus] = useState<string>(IDLE_STATUS);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  /**
   * A capture can start, finish, or be cancelled while the panel is hidden, so
   * on every open take Rust's word for it rather than the last event seen.
   */
  const resync = useCallback(async () => {
    const running = await invoke<boolean>("capture_in_flight").catch(() => false);
    setBusy(running);
    if (!running) {
      setStatus(IDLE_STATUS);
      setError("");
    }
  }, []);

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

  // The panel is only ever visible while focused, so focus tracks visibility.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) =>
      setPanelVisible(payload),
    );
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // Expiry labels age in place, so keep polling while someone is looking.
  useEffect(() => {
    if (!panelVisible) return;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [panelVisible, refresh]);

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
      if (e.key !== "Escape") return;
      // Escape backs out of settings first, then parks the panel.
      if (settingsOpen) setSettingsOpen(false);
      else void getCurrentWindow().hide();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    const unsubs = [
      listen("panel-shown", () => {
        setSettingsOpen(false);
        setPanelVisible(true);
        void resync();
      }),
      listen<string>("share-status", (e) => {
        setBusy(true);
        setStatus(e.payload);
        setError("");
      }),
      listen("share-cancelled", () => {
        setBusy(false);
        setStatus("Capture cancelled");
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
  }, [refresh, resync]);

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
      } else if (
        msg.toLowerCase().includes("screen") &&
        (msg.toLowerCase().includes("record") ||
          msg.toLowerCase().includes("capture") ||
          msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("denied"))
      ) {
        setError(
          "Screen Recording is off for HauntShot. System Settings → Privacy & Security → Screen Recording — enable HauntShot, then try again.",
        );
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
    quota?.dailyLimit == null
      ? `Paid · ${quota?.usedToday ?? 0} today`
      : `Free · ${quota?.usedToday ?? 0}/${FREE_DAILY_LIMIT} today`;

  return (
    <main className="shell">
      <header className="header">
        <strong>{settingsOpen ? "Settings" : "HauntShot"}</strong>
        {settingsOpen ? null : <span className="quota">{liveLabel}</span>}
      </header>

      {settingsOpen ? (
        <p className="hint">
          Nothing here is wired up yet — these are placeholders.
        </p>
      ) : null}

      {settingsOpen ? null : error ? <p className="error">{error}</p> : null}
      {settingsOpen ? null : status ? <p className="status">{status}</p> : null}

      {settingsOpen ? (
        <Settings />
      ) : (
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
      )}

      <footer className="footer">
        <button
          type="button"
          className="capture-button"
          disabled={busy}
          aria-label="Capture"
          aria-busy={busy}
          title={`Capture · ${DEFAULT_HOTKEY}`}
          onClick={() => void capture()}
        >
          <CaptureIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={settingsOpen ? "Back to captures" : "Settings"}
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <GearIcon />
        </button>
      </footer>
    </main>
  );
}
