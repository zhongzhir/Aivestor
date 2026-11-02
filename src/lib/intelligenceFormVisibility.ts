export interface IntelligenceFormVisibilityInput {
  lookbackKind: string;
  executionMode: "manual" | "scheduled";
  frequency: string;
}

export interface IntelligenceFormVisibility {
  showCustomRange: boolean;
  showSchedule: boolean;
  showWeekday: boolean;
}

export function intelligenceFormVisibility({
  lookbackKind,
  executionMode,
  frequency,
}: IntelligenceFormVisibilityInput): IntelligenceFormVisibility {
  const showSchedule = executionMode === "scheduled";
  return {
    showCustomRange: lookbackKind === "custom",
    showSchedule,
    showWeekday: showSchedule && frequency === "weekly",
  };
}
