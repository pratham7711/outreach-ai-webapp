import { readDeletionConfirmationCode } from "./metaSignedRequest";

export type MetaDeletionStatus = {
  confirmation_code: string;
  status: "complete";
  /** Absent on a code issued before codes recorded their outcome. */
  deleted?: boolean;
  detail: string;
};

/**
 * What a Meta data-deletion confirmation code says happened, or null when this
 * app never issued it. One source for the JSON status API and the /data-deletion
 * page Meta sends the person to, so the two cannot disagree.
 */
export function metaDeletionStatus(code: string): MetaDeletionStatus | null {
  const outcome = code ? readDeletionConfirmationCode(code) : null;
  if (!outcome) return null;
  if (outcome === "none") {
    return {
      confirmation_code: code,
      status: "complete",
      deleted: false,
      detail:
        "When the request was received we held no linked-account data or access tokens for this account, so there was nothing to delete.",
    };
  }
  if (outcome === "legacy") {
    /* Issued before codes recorded their outcome, so whether rows went is not
       known here; say only what is true of every one of them. */
    return {
      confirmation_code: code,
      status: "complete",
      detail:
        "The request was processed when it was received. Any linked-account data and access tokens matching this account were deleted at that time.",
    };
  }
  return {
    confirmation_code: code,
    status: "complete",
    deleted: true,
    detail:
      "All linked-account data and access tokens for this account were deleted when the request was received.",
  };
}
