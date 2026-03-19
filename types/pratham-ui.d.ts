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
  export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string; error?: string; iconLeft?: React.ReactNode; iconRight?: React.ReactNode;
  }
  export const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>
  export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string; error?: string;
  }
  export const Textarea: React.ForwardRefExoticComponent<TextareaProps & React.RefAttributes<HTMLTextAreaElement>>
  export interface ModalProps {
    open: boolean; onClose: () => void; title?: string; size?: "sm"|"md"|"lg";
    children?: React.ReactNode; footer?: React.ReactNode;
  }
  export const Modal: React.FC<ModalProps>
  export interface EmptyStateProps {
    icon?: React.ReactNode | string; title: string; description?: string;
    action?: React.ReactNode; children?: React.ReactNode;
  }
  export const EmptyState: React.FC<EmptyStateProps>
  export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
    variant?: "accent"|"success"|"warning"|"danger"|"neutral";
    clickable?: boolean; outlined?: boolean; children?: React.ReactNode;
  }
  export const Tag: React.FC<TagProps>
  export interface TooltipProps {
    content: React.ReactNode; children: React.ReactNode;
    position?: "top"|"bottom"|"left"|"right";
  }
  export const Tooltip: React.FC<TooltipProps>
  export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
    src?: string; name?: string; size?: "sm"|"md"|"lg";
  }
  export const Avatar: React.FC<AvatarProps>
  export const LoadingSpinner: React.FC<{ size?: number; color?: string }>
  export const GlassPanel: React.FC<React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }>
  export const Nav: React.FC<{ children?: React.ReactNode }>
  export const Footer: React.FC<{ children?: React.ReactNode }>
  export const Skeleton: React.FC<{ width?: string | number; height?: string | number; borderRadius?: string | number }>
  export const ConnectionStatus: React.FC<{ status: string; label?: string }>
}

declare module "@pratham7711/ui/styles" {}
