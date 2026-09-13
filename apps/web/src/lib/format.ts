import type { TaskStatus } from "@donelayer/shared";
import type { StatusTone } from "@/components/ui/status";

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = Math.round(minutes % 60);
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

export function formatRelativeTime(value: string): string {
  const difference = Date.now() - Date.parse(value);
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function taskStatusTone(status: TaskStatus): StatusTone {
  if (status === "COMPLETED" || status === "VERIFICATION_PASSED") return "success";
  if (status === "VERIFICATION_FAILED" || status === "CANCELLED" || status === "DISPUTED") return "danger";
  if (status === "RUNNING" || status === "SUBMITTED" || status === "VERIFYING") return "info";
  if (status === "EXPIRED") return "neutral";
  return "warning";
}
