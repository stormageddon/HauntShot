import { DEFAULT_HOTKEY } from "@hauntshot/shared";

/** Outlines only — every control here is inert until the feature lands. */
const SETTINGS = [
  {
    name: "Appearance",
    note: "Follow the system, or pin light or dark",
    action: "System",
  },
  {
    name: "Capture hotkey",
    note: DEFAULT_HOTKEY,
    action: "Change",
  },
  {
    name: "HauntShot Pro",
    note: "Unlimited live links · $4.99/mo or $29.99/yr",
    action: "Upgrade",
  },
];

export default function Settings() {
  return (
    <section className="list">
      {SETTINGS.map((setting) => (
        <div className="row" key={setting.name}>
          <div className="meta">
            <div className="ttl">
              {setting.name} <span className="soon">Soon</span>
            </div>
            <div className="url">{setting.note}</div>
          </div>
          <button type="button" disabled>
            {setting.action}
          </button>
        </div>
      ))}
    </section>
  );
}
