"use client";

import React from "react";
import { Button as UIButton } from "@pratham7711/ui";

/**
 * The library's Button, with the loading state fixed.
 *
 * Theirs throws the children away while loading and renders a 14px spinner in
 * their place, so "Refresh Data" collapses to about a third of its width. Every
 * button beside it slides across, and a toolbar that was wrapping onto two rows
 * un-wraps and jumps up the page -- which is what you see when you press it.
 *
 * Here the label stays exactly where it is and is merely hidden, with the
 * spinner laid over the top, so the button keeps its size and nothing moves.
 */

type ButtonProps = React.ComponentProps<typeof UIButton>;

/**
 * `variant="primary"` already says this button is the screen's main action, so
 * it is also where the theming hook belongs -- emitted once here rather than
 * hand-added at 11 call sites, where it would be forgotten on the twelfth.
 *
 * `secondary` carries the same hook for the same reason. MEASURED 2026-09-14 at
 * desktop-1600: the reference's action cluster is two IDENTICAL boxes -- New
 * Campaign 1188..1367.5 and Folders 1374..1553.5, both 180x40; on the campaign
 * header, Refresh Data 1117..1316.5 and Add Posts 1332..1531.5, both 200x45. Our
 * secondary measured 134x38 beside a 200x45 primary, and no landmark addressed
 * it, so the harness reported the header as clean.
 *
 * The hook is `data-cc-slot`, NOT `data-slot`: `data-slot` is shadcn's, has 87
 * uses in this repo, and globals.css already targets `[data-slot="card"]`.
 *
 * A call site that needs to say otherwise -- a primary-looking button that is
 * not the page's action -- passes its own `data-cc-slot` and that wins, because
 * `rest` is spread after this.
 */
const slotFor = (props: ButtonProps) =>
  props.variant === "primary" || props.variant === "secondary"
    ? { "data-cc-slot": props.variant }
    : null;

export function Button({ loading, children, style, disabled, ...rest }: ButtonProps) {
  if (!loading) {
    return <UIButton style={style} disabled={disabled} {...slotFor(rest)} {...rest}>{children}</UIButton>;
  }

  return (
    <UIButton
      {...slotFor(rest)}
      {...rest}
      // Deliberately not passing `loading` -- that is the prop that drops the
      // children. The button still needs to be un-pressable and announced.
      disabled
      aria-busy="true"
      style={{ position: "relative", ...style }}
    >
      <span style={{ visibility: "hidden", display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute", top: "50%", left: "50%", marginTop: -7, marginLeft: -7,
          width: 14, height: 14, borderRadius: "50%",
          border: "2px solid transparent", borderTopColor: "currentColor",
          animation: "cc-spin 0.7s linear infinite",
        }}
      />
    </UIButton>
  );
}
