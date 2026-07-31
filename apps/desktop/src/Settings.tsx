import { DEFAULT_HOTKEY } from "@hauntshot/shared";

export function GearIcon() {
  // Ring plus eight teeth — drawn from primitives so it stays crisp at 15px.
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      {teeth.map((angle) => (
        <rect
          key={angle}
          x="10.5"
          y="1.8"
          width="3"
          height="4.4"
          rx="0.8"
          fill="currentColor"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <circle
        cx="12"
        cy="12"
        r="6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
      />
    </svg>
  );
}

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
