"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Instagram } from "lucide-react";
import { Button, SectionCard, Skeleton, useConfirm } from "@/components/ds";
import { apiFetch } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";
import { formatFull } from "@/lib/format";
import { BRAND } from "@/lib/brand";

type AccountView =
  | { configured: boolean; connected: false }
  | {
      configured: boolean;
      connected: true;
      username: string;
      profilePictureUrl: string | null;
      followersCount: number | null;
      connectedAt: string;
      expiresAt: string;
      expired: boolean;
      lastError: string | null;
    };

type RevokeDecision = "revoked" | "revoke-failed" | "shared-grant" | "unknown-grantor" | null;

const START_URL = "/api/settings/integrations/instagram/start";

const CONNECT_ERRORS: Record<string, string> = {
  denied: "Facebook Login was cancelled, so nothing was connected.",
  forbidden: "Only an owner or admin can connect an Instagram account for this workspace.",
  state: "That sign-in expired or was started in another tab. Try Connect again.",
  provider: "Instagram is not set up on this deployment yet.",
  token_exchange: "Facebook did not accept the sign-in. Try Connect again.",
  token_missing: "Facebook did not accept the sign-in. Try Connect again.",
  no_page:
    "Facebook didn't share any Page with us. Connect again, choose “Opt in to current Pages only” and tick the Page your Instagram account is linked to.",
  no_instagram_account:
    "None of the Pages you shared has an Instagram professional account linked. Link one to a Page in Meta Business Suite, then connect again and pick that Page.",
  store: "The account could not be saved. Try again in a moment.",
  exception: "Something went wrong while connecting. Try again in a moment.",
};

function revokeNote(revoke: RevokeDecision): string {
  switch (revoke) {
    case "revoked":
      return "Disconnected, and our access was removed from your Facebook account.";
    case "shared-grant":
      return "Disconnected. The same Facebook user also authorises another connection here, so its permission was left in place.";
    default:
      return "Disconnected. To remove our access entirely, remove the app in Facebook Settings → Business integrations.";
  }
}

/**
 * The org's own Instagram professional account, through which its Business
 * Discovery lookups run. Without one they run on the platform's account.
 */
export function InstagramAccountCard() {
  const [view, setView] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("instagram");
    if (outcome === "connected") toast.success("Instagram Business account connected");
    else if (outcome === "error") toast.error(CONNECT_ERRORS[params.get("reason") ?? ""] ?? CONNECT_ERRORS.exception);
    if (outcome) {
      params.delete("instagram");
      params.delete("reason");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
    apiFetch<AccountView>("/api/settings/integrations/instagram")
      .then(setView)
      .catch((e) => toast.error(errorMessage(e, "Could not load the Instagram account")))
      .finally(() => setLoading(false));
  }, []);

  function connect() {
    setBusy(true);
    window.location.assign(START_URL);
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect this Instagram account?",
      description:
        `Creator lookups for your workspace go back to ${BRAND.umbrella}'s own account. You can connect again at any time.`,
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await apiFetch<AccountView & { revoke: RevokeDecision }>("/api/settings/integrations/instagram", {
        method: "DELETE",
      });
      setView(next);
      toast.success(revokeNote(next.revoke));
    } catch (e) {
      toast.error(errorMessage(e, "Could not disconnect"));
    } finally {
      setBusy(false);
    }
  }

  const title = "Instagram Business account (for creator lookups)";

  if (loading) {
    return (
      <SectionCard icon={Instagram} title={title}>
        <Skeleton width="100%" height={44} />
      </SectionCard>
    );
  }
  if (!view) return null;

  if (!view.connected) {
    return (
      <SectionCard
        icon={Instagram}
        title={title}
        description="Connect your own Instagram professional account so the public profiles and posts you look up are read through it, on your workspace's behalf."
      >
        <div className="cc-provider-row">
          <div className="cc-provider-id">
            <div className="cc-pref-row-text">
              <span className="cc-provider-name">Not connected</span>
              <span className="cc-pref-row-desc">
                {view.configured
                  ? "Used for Add creator, creator profiles, tracker refreshes and post reads. You pick the Facebook Page and Instagram account in Facebook's own screen."
                  : "Instagram sign-in is not set up on this deployment."}
              </span>
            </div>
          </div>
          <Button className="cc-provider-cta" onClick={connect} disabled={busy || !view.configured}>
            Connect with Facebook
          </Button>
        </div>
      </SectionCard>
    );
  }

  const needsReconnect = view.expired;
  return (
    <SectionCard icon={Instagram} title={title}>
      <div className="cc-provider-row">
        <div className="cc-provider-id">
          {view.profilePictureUrl && !pictureFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- Instagram's signed picture URL, shown as given; next/image would need its CDN allow-listed
            <img
              className="cc-ig-account-avatar"
              src={view.profilePictureUrl}
              alt=""
              onError={() => setPictureFailed(true)}
            />
          ) : (
            <span className="cc-ig-account-avatar" aria-hidden>
              <Instagram size={18} />
            </span>
          )}
          <div className="cc-pref-row-text">
            <span className="cc-provider-name">
              @{view.username}
              {view.followersCount !== null ? (
                <span className="cc-pref-row-desc"> · {formatFull(view.followersCount)} followers</span>
              ) : null}
            </span>
            <span className={needsReconnect ? "cc-ig-account-warning" : "cc-pref-row-desc"}>
              {needsReconnect
                ? `This account needs reconnecting, so lookups use ${BRAND.umbrella}'s own account meanwhile.${view.lastError ? ` ${view.lastError}` : ""}`
                : "Lookups for your workspace use this account."}
            </span>
          </div>
        </div>
        <div className="cc-ig-account-actions">
          {needsReconnect ? (
            <Button className="cc-provider-cta" onClick={connect} disabled={busy || !view.configured}>
              Reconnect
            </Button>
          ) : null}
          <Button variant="danger" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
