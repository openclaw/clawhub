export declare const MAX_PACKAGE_MULTIPART_BYTES: number;
export declare const MAX_PACKAGE_CLAWPACK_BYTES: number;
export type PackageMultipartUploadField = "files" | "clawpack";
export type PackageMultipartUploadPart = {
    name: string;
    size: number;
    type?: string;
};
export type PackageMultipartUploadSizeInput = {
    payloadJson: string;
    fileFieldName: PackageMultipartUploadField;
    files: readonly PackageMultipartUploadPart[];
};
export declare function estimatePackageMultipartUploadBytes(input: PackageMultipartUploadSizeInput): number;
export declare function isPackageMultipartUploadTooLarge(input: PackageMultipartUploadSizeInput): boolean;
export declare function getPackageMultipartSizeError(): string;
