import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_HOTKEY, FREE_DAILY_LIMIT } from "@hauntshot/shared";

/** Settings that are live; placeholders stay marked Soon. */
export default function Settings() {
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

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

      <div className="row">
        <div className="meta">
          <div className="ttl">
            HauntShot Pro <span className="soon">Soon</span>
          </div>
          <div className="url">
            Unlimited captures · $4.99/mo or $29.99/yr · free is {FREE_DAILY_LIMIT}
            /day
          </div>
        </div>
        <button type="button" disabled>
          Upgrade
        </button>
      </div>
    </section>
  );
}
