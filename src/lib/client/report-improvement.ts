/** Open the in-app Report improvement dialog (CustomEvent). */
export const REPORT_EVENT = "lm:report-improvement";

export function openReportImprovement() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REPORT_EVENT));
  }
}
