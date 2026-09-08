import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_HOTKEY, FREE_DAILY_LIMIT } from "@hauntshot/shared";

type Props = {
  apiBase: string;
  deviceId: string | null;
  tier: "free" | "paid" | null;
  onBillingChange?: () => void;
};

export default function Settings({
  apiBase,
  deviceId,
  tier,
  onBillingChange,
}: Props) {
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [updateMsg, setUpdateMsg] = useState("");

  useEffect(() => {
    void isEnabled()
      .then(setLaunchAtLogin)
      .catch(() => setLaunchAtLogin(null));
  }, []);

  async function toggleLaunchAtLogin() {
    if (launchAtLogin == null || busy) return;
    setBusy(true);
    try {
      if (launchAtLogin) await disable();
      else await enable();
      setLaunchAtLogin(await isEnabled());
    } catch {
      // Leave the toggle alone if the OS refuses.
    } finally {
      setBusy(false);
    }
  }

  async function startUpgrade() {
    if (!deviceId || busy) return;
    setBusy(true);
    setBillingError("");
    try {
      const url = `${apiBase}/billing/upgrade?device_id=${encodeURIComponent(deviceId)}`;
      await openUrl(url);
      onBillingChange?.();
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    if (!deviceId || busy) return;
    setBusy(true);
    setBillingError("");
    try {
      const res = await fetch(`${apiBase}/v1/billing/portal`, {
        method: "POST",
        headers: { "X-HauntShot-Device-Id": deviceId },
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `Portal failed (${res.status})`);
      }
      await openUrl(data.url);
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkForUpdates() {
    if (busy) return;
    setBusy(true);
    setUpdateMsg("");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        setUpdateMsg("You're on the latest version.");
        return;
      }
      setUpdateMsg(`Downloading ${update.version}…`);
      await update.downloadAndInstall();
      setUpdateMsg("Restarting…");
      await relaunch();
    } catch (e) {
      setUpdateMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="list">
      <div className="row">
        <div className="meta">
          <div className="ttl">Launch at login</div>
          <div className="url">Come back after reboot without hunting for the app</div>
        </div>
        <button
          type="button"
          disabled={launchAtLogin == null || busy}
          aria-pressed={launchAtLogin ?? false}
          onClick={() => void toggleLaunchAtLogin()}
        >
          {launchAtLogin ? "On" : launchAtLogin == null ? "…" : "Off"}
        </button>
      </div>

      <div className="row">
        <div className="meta">
          <div className="ttl">Updates</div>
          <div className="url">
            {updateMsg || "Check for a newer HauntShot build and install it"}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void checkForUpdates()}
        >
          Check
        </button>
      </div>

      <div className="row">
        <div className="meta">
          <div className="ttl">
            Appearance <span className="soon">Soon</span>
          </div>
          <div className="url">Follow the system, or pin light or dark</div>
        </div>
        <button type="button" disabled>
          System
        </button>
      </div>

      <div className="row">
        <div className="meta">
          <div className="ttl">
            Capture hotkey <span className="soon">Soon</span>
          </div>
          <div className="url">{DEFAULT_HOTKEY}</div>
        </div>
        <button type="button" disabled>
          Change
        </button>
      </div>

      {tier === "paid" ? (
        <div className="row">
          <div className="meta">
            <div className="ttl">HauntShot Pro</div>
            <div className="url">Unlimited captures · manage plan or cancel</div>
          </div>
          <button
            type="button"
            disabled={busy || !deviceId}
            onClick={() => void openPortal()}
          >
            Manage
          </button>
        </div>
      ) : (
        <div className="row">
          <div className="meta">
            <div className="ttl">HauntShot Pro</div>
            <div className="url">
              Unlimited · $4.99/mo or $29.99/yr · free is {FREE_DAILY_LIMIT}/day
            </div>
          </div>
          <button
            type="button"
            disabled={busy || !deviceId}
            onClick={() => void startUpgrade()}
          >
            Upgrade
          </button>
        </div>
      )}

      {billingError ? <p className="error">{billingError}</p> : null}
    </section>
  );
}
