"use client";

import { useEffect, type ReactNode } from "react";
import {
  LazyMotion,
  MotionConfig,
  animate,
  domAnimation,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { StageArt, type StageKey } from "./LandingStageArt";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** The homepage's motion features, loaded once; a reduced-motion setting drops movement. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** A figure that runs from its old value to its new one when a control changes it. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(Math.round(v)));

  useEffect(() => {
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.65, ease: EASE_OUT });
    return () => controls.stop();
  }, [value, reduced, mv]);

  return <m.span>{text}</m.span>;
}

/* The strip reads as one record moving through five stages: each rule inks in
   from the left, one after the other, and that stage's slice of the app
   arrives with it. */
export function StageStrip({ stages }: { stages: { name: string; key: StageKey; lead: string }[] }) {
  return (
    <ol className="mb-stages">
      {stages.map((s, i) => (
        <m.li
          key={s.key}
          className="mb-stage"
          initial="rest"
          whileInView="shown"
          viewport={{ once: true, amount: 0.5 }}
          variants={{ rest: {}, shown: { transition: { delayChildren: i * 0.12 } } }}
        >
          <m.span
            className="mb-stage-rule"
            aria-hidden
            variants={{ rest: { scaleX: 0 }, shown: { scaleX: 1 } }}
            transition={{ duration: 0.7, ease: EASE_OUT }}
          />
          <span className="mb-stage-n" aria-hidden>
            <m.span
              variants={{ rest: { y: "100%" }, shown: { y: "0%" } }}
              transition={{ duration: 0.8, ease: EASE_OUT }}
            >
              {i + 1}
            </m.span>
          </span>
          <h3 className="mb-stage-name">{s.name}</h3>
          <m.div
            variants={{ rest: { opacity: 0.3, y: 14 }, shown: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.1 }}
          >
            <StageArt stage={s.key} />
          </m.div>
          <p className="mb-stage-text">{s.lead}</p>
        </m.li>
      ))}
    </ol>
  );
}
