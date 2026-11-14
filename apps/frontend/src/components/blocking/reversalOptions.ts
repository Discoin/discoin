import type { ReverseDirection, ReverseWindow } from "../../api/types.js";
import type { RadioOption } from "../shared/RadioGroup.jsx";

export const WINDOW_OPTIONS: RadioOption<ReverseWindow>[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

export const DIRECTION_OPTIONS: RadioOption<ReverseDirection>[] = [
  { value: "incoming", label: "Incoming (into your currency)" },
  { value: "outgoing", label: "Outgoing (out of your currency)" },
  { value: "both", label: "Both" },
];
