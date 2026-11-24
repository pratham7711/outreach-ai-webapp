import type { KeyboardEvent } from "react";

/** True while Enter is confirming an IME candidate (Japanese, Chinese, Korean
    input), not submitting. Safari resets isComposing before the confirming
    keydown reaches script, so keyCode 229 is checked as well. */
export function isImeConfirm(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
