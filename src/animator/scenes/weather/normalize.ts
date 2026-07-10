import { WeatherType } from "./WeatherSystem.tsx";

export function normalizeWeather(requested: string, allowedWeather: string[]): WeatherType {
  if (allowedWeather.includes(requested)) {
    return requested as WeatherType;
  }
  return "clear";
}
