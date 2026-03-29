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

  // Tabs
  export interface TabItem { label: string; value: string; icon?: React.ReactNode }
  export type TabsVariant = "pills" | "underline" | "solid"
  export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
    items: TabItem[]; activeTab: string; onChange: (value: string) => void; variant?: TabsVariant;
  }
  export const Tabs: React.ForwardRefExoticComponent<TabsProps & React.RefAttributes<HTMLDivElement>>

  // Dropdown
  export interface DropdownItem { label: string; icon?: React.ReactNode; onClick?: () => void; danger?: boolean }
  export interface DropdownProps extends React.HTMLAttributes<HTMLDivElement> {
    trigger: React.ReactNode; items: DropdownItem[]; align?: "left" | "right";
  }
  export const Dropdown: React.ForwardRefExoticComponent<DropdownProps & React.RefAttributes<HTMLDivElement>>

  // ProgressBar
  export type ProgressBarVariant = "accent" | "success" | "warning" | "danger"
  export type ProgressBarSize = "sm" | "md"
  export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
    value: number; variant?: ProgressBarVariant; size?: ProgressBarSize; showLabel?: boolean; animated?: boolean;
  }
  export const ProgressBar: React.ForwardRefExoticComponent<ProgressBarProps & React.RefAttributes<HTMLDivElement>>

  // Toggle
  export type ToggleSize = "sm" | "md"
  export interface ToggleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
    checked: boolean; onChange: (checked: boolean) => void; label?: string; size?: ToggleSize; disabled?: boolean;
  }
  export const Toggle: React.ForwardRefExoticComponent<ToggleProps & React.RefAttributes<HTMLDivElement>>

  // Breadcrumb
  export interface BreadcrumbItem { label: string; href?: string }
  export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
    items: BreadcrumbItem[]; separator?: React.ReactNode;
  }
  export const Breadcrumb: React.ForwardRefExoticComponent<BreadcrumbProps & React.RefAttributes<HTMLElement>>

  // Alert
  export type AlertVariant = "info" | "success" | "warning" | "danger"
  export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
    variant: AlertVariant; title?: string; children?: React.ReactNode; onClose?: () => void; icon?: React.ReactNode;
  }
  export const Alert: React.ForwardRefExoticComponent<AlertProps & React.RefAttributes<HTMLDivElement>>
}

declare module "@pratham7711/ui/styles" {}
