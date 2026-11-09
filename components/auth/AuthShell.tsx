"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@pratham7711/ui";
import { Banner, type BannerTone } from "@/components/ds/Banner";
import { Field } from "@/components/ds/Field";
import { AuthBrand } from "./AuthBrand";

/**
 * The one signed-out card: brand centred above, then a 400px card whose title
 * and supporting line sit on the same left edge as the field labels under
 * them. Sign-in, sign-up, password reset, email verification, invitations and
 * the creator portal's two forms all draw it, so they share one width, one
 * radius, one inset and one header alignment.
 */
export function AuthShell({
  title,
  subtitle,
  icon,
  children,
  footer,
  below,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A status mark over the title (verified, expired); forms leave it out. */
  icon?: ReactNode;
  children?: ReactNode;
  /** The switch to the other form ("Don't have an account? Sign up"). */
  footer?: ReactNode;
  /** Under the card, outside it. */
  below?: ReactNode;
}) {
  return (
    <div className="cc-auth">
      <motion.div
        className="cc-auth__panel"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="cc-auth__brand">
          <AuthBrand />
        </div>
        <div className="cc-auth__card">
          <header className="cc-auth__head">
            {icon ? (
              <span className="cc-auth__icon" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            <h1 className="cc-auth__title">{title}</h1>
            {subtitle ? <p className="cc-auth__sub">{subtitle}</p> : null}
          </header>
          {children}
          {footer ? <p className="cc-auth__foot">{footer}</p> : null}
        </div>
        {below ? <div className="cc-auth__below">{below}</div> : null}
      </motion.div>
    </div>
  );
}

/**
 * The same backdrop, brand and card as AuthShell, for pages that draw several
 * states (checking, failed, the form) and so lay out their own header. Their
 * titles use `.cc-auth__title` / `.cc-auth__sub`.
 */
export function AuthFrame({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <div className="cc-auth">
      <motion.div
        className="cc-auth__panel"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="cc-auth__brand">
          <AuthBrand />
        </div>
        <div className="cc-auth__card">{children}</div>
        {below ? <div className="cc-auth__below">{below}</div> : null}
      </motion.div>
    </div>
  );
}

/** A notice inside the auth card: the in-card banner, so tone and inset match the app's. */
export function AuthNotice({
  tone,
  role,
  children,
}: {
  tone: BannerTone;
  role?: "status" | "alert";
  children: ReactNode;
}) {
  return (
    <Banner tone={tone} placement="inline" role={role ?? (tone === "danger" ? "alert" : "status")} className="cc-auth__notice">
      {children}
    </Banner>
  );
}

/** The form body: fields 16px apart, the submit full width. */
export function AuthForm({
  onSubmit,
  noValidate,
  children,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  /** For a page that checks its own fields; otherwise the browser's required check runs. */
  noValidate?: boolean;
  children: ReactNode;
}) {
  return (
    <form className="cc-auth__form" onSubmit={onSubmit} noValidate={noValidate}>
      {children}
    </form>
  );
}

/**
 * A required password field with a show/hide button over its right end. The
 * button sits beside the Field rather than inside the input's icon slot,
 * because that slot is aria-hidden and a control in it would be unreachable.
 */
export function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  helper,
  error,
  id,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete: "current-password" | "new-password";
  helper?: ReactNode;
  error?: ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="cc-auth__password" data-noted={helper || error ? true : undefined}>
      <Field label={label} required helper={helper} error={error} id={id}>
        <Input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
        />
      </Field>
      <button
        type="button"
        className="cc-auth__reveal"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
