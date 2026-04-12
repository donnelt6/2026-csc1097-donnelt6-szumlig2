// dateUtils.ts: Date and time formatting utilities shared across components.

export function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

export function formatIrelandDateTime(date: Date) {
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function formatLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatIrelandDateTime(date);
}

export function toLocalInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function toIsoFromLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
