/** Fixed display scale; independent of simulation and thermostat settings. */
export const TEMPERATURE_MIN_C = 15;
export const ROOM_TEMPERATURE_C = 20;
export const TEMPERATURE_MAX_C = 25;
export const NEUTRAL_TEMPERATURE_STRENGTH = 0.04;

export function temperaturePosition(temperatureC: number): number {
  return Math.max(0, Math.min(1, (temperatureC - TEMPERATURE_MIN_C) / (TEMPERATURE_MAX_C - TEMPERATURE_MIN_C)));
}

/** A faint tint at room temperature, smoothly reaching full strength at ±5°C. */
export function temperatureStrength(temperatureC: number): number {
  const x = Math.min(1, Math.abs(temperatureC - ROOM_TEMPERATURE_C) / (TEMPERATURE_MAX_C - ROOM_TEMPERATURE_C));
  return NEUTRAL_TEMPERATURE_STRENGTH + (1 - NEUTRAL_TEMPERATURE_STRENGTH) * x * x * (3 - 2 * x);
}
