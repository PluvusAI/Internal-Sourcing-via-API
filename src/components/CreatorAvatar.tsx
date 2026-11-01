import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MemberView } from "../../server/sourceClient";

/** A saved picture sits behind sign-in, which an <img> cannot send: read it once it is near the screen. */
function useSavedPicture(memberId: string, saved: boolean, element: RefObject<HTMLElement>): { url: string | null; pending: boolean } {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!saved || near || !element.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: "200px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [saved, near, element]);
  const picture = useQuery({ queryKey: ["creator-picture", memberId], queryFn: () => api.memberPicture(memberId), enabled: saved && near, staleTime: Infinity, retry: false });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picture.data) return;
    const objectUrl = URL.createObjectURL(picture.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [picture.data]);
  return { url, pending: saved && !picture.isError && !url };
}

/** Image / initials fallback pattern adapted from 21st.dev @appica-dev/avatar. */
export function CreatorAvatar({ member, large = false }: { member: Pick<MemberView, "id" | "pictureUrl" | "pictureStored" | "displayName" | "handle">; large?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const saved = useSavedPicture(member.id, member.pictureStored, element);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const name = member.displayName?.trim() || member.handle?.replace(/^@/, "") || "Creator";
  const initials = name.split(/\s+/).map(part => Array.from(part)[0]).slice(0, 2).join("").toUpperCase();
  const src = member.pictureStored ? saved.url : member.pictureUrl?.trim();
  const loading = saved.pending || Boolean(src && src !== failedUrl && src !== loadedUrl);
  return <span ref={element} className={`creator-avatar${large ? " creator-avatar-large" : ""}`} data-loading={loading} aria-hidden="true">
    <span>{initials}</span>
    {src && src !== failedUrl ? <img key={src} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" data-loaded={src === loadedUrl} onLoad={() => setLoadedUrl(src)} onError={() => setFailedUrl(src)} /> : null}
  </span>;
}
