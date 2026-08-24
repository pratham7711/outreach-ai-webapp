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

export function Button({ loading, children, style, disabled, ...rest }: ButtonProps) {
  if (!loading) {
    return <UIButton style={style} disabled={disabled} {...rest}>{children}</UIButton>;
  }

  return (
    <UIButton
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
