"use client";
import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";
import { ease } from "./ui";

// Calm, one-time entrances for the marketing page. Reduced-motion users get the content without movement.
export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.6, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// The product shot settles in slightly after the headline.
export function HeroShot({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.25, ease }}
      className="relative"
    >
      {children}
    </motion.div>
  );
}

// A thin rule that draws across the steps as they scroll into view.
export function Rule() {
  return (
    <motion.span
      aria-hidden
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 1.2, ease }}
      className="absolute inset-x-0 top-[15px] hidden h-px origin-left bg-ink/15 md:block"
    />
  );
}
