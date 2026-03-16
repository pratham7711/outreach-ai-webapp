declare module "@pratham7711/ui" {
  import React from "react"
  export type ButtonVariant = "primary"|"secondary"|"ghost"|"danger"|"glow"
  export type ButtonSize = "sm"|"md"|"lg"
  export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant; size?: ButtonSize; loading?: boolean;
    iconLeft?: React.ReactNode; iconRight?: React.ReactNode; fullWidth?: boolean; children?: React.ReactNode;
  }
  export const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>
  export type CardVariant = "glass"|"solid"|"outlined"
  export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: CardVariant; clickable?: boolean; noPadding?: boolean; children?: React.ReactNode;
  }
  export const Card: React.ForwardRefExoticComponent<CardProps & React.RefAttributes<HTMLDivElement>>
  export type BadgeVariant = "accent"|"success"|"warning"|"danger"|"neutral"
  export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    variant?: BadgeVariant; size?: "sm"|"md"; outlined?: boolean; dot?: boolean; children?: React.ReactNode;
  }
  export const Badge: React.ForwardRefExoticComponent<BadgeProps & React.RefAttributes<HTMLSpanElement>>
  export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
    value: string; label: string; trend?: number; trendLabel?: string; icon?: React.ReactNode;
  }
  export const StatCard: React.FC<StatCardProps>
  export interface SectionHeaderProps { title: string; subtitle?: string; overline?: string; align?: "left"|"center"|"right"; }
  export const SectionHeader: React.FC<SectionHeaderProps>
}

declare module "@pratham7711/ui/styles" {}
