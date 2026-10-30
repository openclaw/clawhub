// Keep browser upload helpers independent of the runtime validators.
// The public registry API is served through Vercel functions, which reject request
// bodies over 4.5 MB before ClawHub code runs. Inline multipart publishes stay under
// that cap; larger ClawPacks stage through the upload-url flow straight into storage.
const MAX_PACKAGE_MULTIPART_MB = 4;
export const MAX_PACKAGE_MULTIPART_BYTES = MAX_PACKAGE_MULTIPART_MB * 1024 * 1024;
export const MAX_PACKAGE_CLAWPACK_BYTES = 120 * 1024 * 1024;
const PACKAGE_MULTIPART_FIXED_OVERHEAD_BYTES = 4096;
const PACKAGE_MULTIPART_PART_OVERHEAD_BYTES = 1024;
export function estimatePackageMultipartUploadBytes(input) {
    return (PACKAGE_MULTIPART_FIXED_OVERHEAD_BYTES +
        estimateMultipartStringPartBytes("payload", input.payloadJson) +
        input.files.reduce((sum, file) => sum + estimateMultipartFilePartBytes(input.fileFieldName, file), 0));
}
export function isPackageMultipartUploadTooLarge(input) {
    return estimatePackageMultipartUploadBytes(input) > MAX_PACKAGE_MULTIPART_BYTES;
}
export function getPackageMultipartSizeError() {
    return `Package upload exceeds ${MAX_PACKAGE_MULTIPART_MB}MB multipart upload limit`;
}
function estimateMultipartStringPartBytes(fieldName, value) {
    return PACKAGE_MULTIPART_PART_OVERHEAD_BYTES + utf8ByteLength(fieldName) + utf8ByteLength(value);
}
function estimateMultipartFilePartBytes(fieldName, file) {
    return (file.size +
        PACKAGE_MULTIPART_PART_OVERHEAD_BYTES +
        utf8ByteLength(fieldName) +
        utf8ByteLength(file.name) +
        utf8ByteLength(file.type ?? ""));
}
function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index);
        if (codePoint === undefined)
            continue;
        if (codePoint > 0xffff)
            index += 1;
        if (codePoint <= 0x7f) {
            bytes += 1;
        }
        else if (codePoint <= 0x7ff) {
            bytes += 2;
        }
        else if (codePoint <= 0xffff) {
            bytes += 3;
        }
        else {
            bytes += 4;
        }
    }
    return bytes;
}
//# sourceMappingURL=packageUploadLimits.js.map