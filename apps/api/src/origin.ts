/**
 * Public origin for viewer/share URLs.
 *
 * wrangler dev remaps Host and request.url to the first custom_domain
 * (hauntshot.com), so using `new URL(c.req.url).origin` would hand out
 * production links for local captures.
 */

const LOCAL_DEV_ORIGIN = "http://127.0.0.1:8787";

type OriginRequest = {
  req: {
    url: string;
    header: (name: string) => string | undefined;
  };
  env?: { PUBLIC_ORIGIN?: string };
};

export function requestOrigin(c: OriginRequest): string {
  const configured = c.env?.PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");

  if (c.req.header("MF-Original-Hostname")) {
    return LOCAL_DEV_ORIGIN;
  }
  return new URL(c.req.url).origin;
}
