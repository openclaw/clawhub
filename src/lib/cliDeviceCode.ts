// Device user codes must never be treated as OAuth completion codes.
export function isCliDeviceUserCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/i.test(value.trim());
}
