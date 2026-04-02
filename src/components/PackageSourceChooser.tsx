import { Package } from 'lucide-react';
import type { PackageCompatibility } from 'clawhub-schema';
import { useRef, useState } from 'react';
import { expandDroppedItems } from '../lib/uploadFiles';
import { formatBytes } from '../routes/upload/-utils';
import { formatPackageCompatibility } from '../lib/pluginPublishPrefill';

export function PackageSourceChooser(props: {
  files: File[];
  totalBytes: number;
  normalizedPaths: string[];
  normalizedPathSet: Set<string>;
  ignoredPaths: string[];
  detectedPrefillFields: string[];
  family: 'code-plugin' | 'bundle-plugin';
  validationError: string | null;
  codePluginFieldIssues: string[];
  codePluginCompatibility: PackageCompatibility | null;
  onPickFiles: (selected: File[]) => Promise<void>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const isMetadataLocked = props.files.length === 0 || Boolean(props.validationError);

  const setDirectoryInputRef = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (node) {
      node.setAttribute('webkitdirectory', '');
      node.setAttribute('directory', '');
    }
  };

  return (
    <div className="card upload-panel">
      <input
        ref={archiveInputRef}
        className="upload-file-input"
        type="file"
        multiple
        accept=".zip,.tgz,.tar.gz,application/zip,application/gzip,application/x-gzip,application/x-tar"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          void props.onPickFiles(selected);
        }}
      />
      <input
        ref={setDirectoryInputRef}
        className="upload-file-input"
        type="file"
        multiple
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          void props.onPickFiles(selected);
        }}
      />
      <div
        className={`upload-dropzone${isDragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void (async () => {
            const dropped = event.dataTransfer.items?.length
              ? await expandDroppedItems(event.dataTransfer.items)
              : Array.from(event.dataTransfer.files);
            await props.onPickFiles(dropped);
          })();
        }}
      >
        <div className="plugin-dropzone-art" aria-hidden="true">
          <Package size={28} />
        </div>
        <div className="upload-dropzone-copy">
          <div className="upload-dropzone-title-row">
            <strong>Upload plugin code first</strong>
            <span className="upload-dropzone-count">
              {props.files.length} files · {formatBytes(props.totalBytes)}
            </span>
          </div>
          <span className="upload-dropzone-hint">
            Drag a folder, zip, or tgz here. We inspect the package to unlock and prefill the rest
            of the form.
          </span>
          <div className="plugin-dropzone-actions">
            <button
              className="btn upload-picker-btn"
              type="button"
              onClick={() => archiveInputRef.current?.click()}
            >
              Browse files
            </button>
            <button
              className="btn upload-picker-btn plugin-dropzone-secondary"
              type="button"
              onClick={() => directoryInputRef.current?.click()}
            >
              Choose folder
            </button>
          </div>
        </div>
      </div>

      <div className={`plugin-upload-summary${isMetadataLocked ? '' : ' is-ready'}`}>
        {props.normalizedPaths.length === 0 ? (
          <div className="stat">No plugin package selected yet.</div>
        ) : (
          <>
            <div className="plugin-upload-summary-row">
              <strong>Package detected</strong>
              <span className="upload-dropzone-count">
                {props.files.length} files · {formatBytes(props.totalBytes)}
              </span>
            </div>
            <div className="plugin-upload-summary-copy">
              {props.detectedPrefillFields.length > 0
                ? `Autofilled ${props.detectedPrefillFields.join(', ')}.`
                : 'Package files were detected. Review and fill the release details below.'}
            </div>
            <div className="plugin-upload-summary-tags">
              {props.normalizedPathSet.has('package.json') ? (
                <span className="tag">Package manifest</span>
              ) : null}
              {props.normalizedPathSet.has('openclaw.plugin.json') ? (
                <span className="tag">Plugin manifest</span>
              ) : null}
              {props.normalizedPathSet.has('openclaw.bundle.json') ? (
                <span className="tag">Bundle manifest</span>
              ) : null}
              {props.normalizedPathSet.has('readme.md') || props.normalizedPathSet.has('readme.mdx') ? (
                <span className="tag">README</span>
              ) : null}
              {props.ignoredPaths.length > 0 ? (
                <span className="tag">Ignored {props.ignoredPaths.length} files</span>
              ) : null}
            </div>
          </>
        )}
      </div>
      {props.validationError ? <div className="tag tag-accent">{props.validationError}</div> : null}
      {props.family === 'code-plugin' && props.codePluginFieldIssues.length > 0 ? (
        <div className="tag tag-accent">
          Missing required OpenClaw package metadata: {props.codePluginFieldIssues.join(', ')}. Add these
          fields to <code>package.json</code> before publishing. See{' '}
          <a href="/plugins/sdk-setup#package-metadata">Plugin Setup and Config</a>.
        </div>
      ) : null}
      {props.family === 'code-plugin' && props.codePluginCompatibility ? (
        <div className="plugin-upload-summary-copy">
          Compatibility: {formatPackageCompatibility(props.codePluginCompatibility)}
        </div>
      ) : null}
    </div>
  );
}
