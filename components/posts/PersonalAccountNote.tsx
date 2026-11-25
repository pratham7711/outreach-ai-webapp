import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import {
  isPersonalAccountPost,
  personalAccountDetail,
  personalAccountLabel,
  type RemovablePost,
} from "@/lib/postRemoval";

/**
 * "Personal Instagram account": the one gap in a measured post that its agency
 * can close. In-app screens only -- the shared client report never renders it.
 * Draws nothing for any other post, so callers place it unconditionally.
 */
export default function PersonalAccountNote({
  post,
  variant = "inline",
  compact = false,
}: {
  post: RemovablePost | null | undefined;
  variant?: "overlay" | "inline";
  compact?: boolean;
}) {
  if (!isPersonalAccountPost(post)) return null;
  return (
    <span data-post-notice="personal-account" style={{ display: "contents" }}>
      <RemovedPostOverlay
        variant={variant}
        compact={compact}
        label={personalAccountLabel()}
        description={personalAccountDetail()}
      />
    </span>
  );
}
