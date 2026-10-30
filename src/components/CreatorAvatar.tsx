import { useState } from "react";
import type { MemberView } from "../../server/sourceClient";

/** Image / initials fallback pattern adapted from 21st.dev @appica-dev/avatar. */
export function CreatorAvatar({ member, large = false }: { member: Pick<MemberView, "pictureUrl" | "displayName" | "handle">; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const name = member.displayName?.trim() || member.handle?.replace(/^@/, "") || "Creator";
  const initials = name.split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join("").toUpperCase();
  const src = member.pictureUrl?.trim();
  const loading = Boolean(src && src !== failedUrl && src !== loadedUrl);
  return <span className={`creator-avatar${large ? " creator-avatar-large" : ""}`} data-loading={loading} aria-hidden="true">
    <span>{initials}</span>
    {src && src !== failedUrl ? <img key={src} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" data-loaded={src === loadedUrl} onLoad={() => setLoadedUrl(src)} onError={() => setFailedUrl(src)} /> : null}
  </span>;
}
