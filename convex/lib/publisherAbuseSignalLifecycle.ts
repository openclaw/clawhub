export type PublisherAbuseRecurrenceSignalType =
  | "sustained_downloads_flat_installs"
  | "sustained_abnormal_download_days"
  | "download_spike_flat_installs"
  | "owner_synchronized_download_trends"
  | "high_install_download_ratio";

const RECURRING_SUSTAINED_SIGNAL_MIN_DOWNLOADS = 1_500;
const RECURRING_SUSTAINED_SIGNAL_MAX_INSTALLS = 5;
const RECURRING_RATIO_SIGNAL_MIN_DOWNLOADS = 500;
const RECURRING_RATIO_SIGNAL_MIN_INSTALLS = 50;
const RECURRING_RATIO_SIGNAL_MIN_RATIO = 0.1;

export function freshPublisherAbuseEvidenceCrossesRepeatThreshold(
  signalType: PublisherAbuseRecurrenceSignalType,
  fresh: { downloads: number; installs: number },
) {
  if (
    signalType === "sustained_downloads_flat_installs" ||
    signalType === "sustained_abnormal_download_days" ||
    signalType === "download_spike_flat_installs" ||
    signalType === "owner_synchronized_download_trends"
  ) {
    return (
      fresh.downloads >= RECURRING_SUSTAINED_SIGNAL_MIN_DOWNLOADS &&
      fresh.installs <= RECURRING_SUSTAINED_SIGNAL_MAX_INSTALLS
    );
  }
  return (
    fresh.downloads >= RECURRING_RATIO_SIGNAL_MIN_DOWNLOADS &&
    fresh.installs >= RECURRING_RATIO_SIGNAL_MIN_INSTALLS &&
    fresh.installs / Math.max(1, fresh.downloads) >= RECURRING_RATIO_SIGNAL_MIN_RATIO
  );
}
