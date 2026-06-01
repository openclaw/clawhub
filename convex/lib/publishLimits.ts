import { MAX_PACKAGE_CLAWPACK_BYTES } from "clawhub-schema";

export {
  estimatePackageMultipartUploadBytes,
  getPackageMultipartSizeError,
  isPackageMultipartUploadTooLarge,
  MAX_PACKAGE_MULTIPART_BYTES,
  type PackageMultipartUploadField,
  type PackageMultipartUploadPart,
} from "clawhub-schema";

export const MAX_PUBLISH_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_PUBLISH_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CLAWPACK_BYTES = MAX_PACKAGE_CLAWPACK_BYTES;

type SizedPathLike = {
  path: string;
  size: number;
};

export function findOversizedPublishFile<TFile extends SizedPathLike>(files: TFile[]) {
  return files.find((file) => file.size > MAX_PUBLISH_FILE_BYTES) ?? null;
}

export function getPublishFileSizeError(path: string) {
  return `File "${path}" exceeds 10MB limit`;
}

export function getPublishTotalSizeError(target: "skill bundle" | "package") {
  return `${target[0]?.toUpperCase() ?? ""}${target.slice(1)} exceeds 50MB limit`;
}

export function getClawPackSizeError(path: string) {
  return `ClawPack "${path}" exceeds 120MB limit`;
}
