import { lazy, Suspense } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillVersionsPanel } from "./SkillVersionsPanel";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const SkillDiffCard = lazy(() =>
  import("./SkillDiffCard").then((module) => ({ default: module.SkillDiffCard })),
);

const SkillFilesPanel = lazy(() =>
  import("./SkillFilesPanel").then((module) => ({ default: module.SkillFilesPanel })),
);

type SkillFile = Doc<"skillVersions">["files"][number];

type SkillDetailTabsProps = {
  activeTab: "files" | "compare" | "versions";
  setActiveTab: (tab: "files" | "compare" | "versions") => void;
  onCompareIntent: () => void;
  readmeContent: string | null;
  readmeError: string | null;
  latestFiles: SkillFile[];
  latestVersionId: Id<"skillVersions"> | null;
  skill: Doc<"skills">;
  diffVersions: Doc<"skillVersions">[] | undefined;
  versions: Doc<"skillVersions">[] | undefined;
  nixPlugin: boolean;
  suppressVersionScanResults: boolean;
  scanResultsSuppressedMessage: string | null;
};

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  onCompareIntent,
  readmeContent,
  readmeError,
  latestFiles,
  latestVersionId,
  skill,
  diffVersions,
  versions,
  nixPlugin,
  suppressVersionScanResults,
  scanResultsSuppressedMessage,
}: SkillDetailTabsProps) {
  return (
    <Card>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger
            value="compare"
            onMouseEnter={() => {
              onCompareIntent();
              void import("./SkillDiffCard");
            }}
            onFocus={() => {
              onCompareIntent();
              void import("./SkillDiffCard");
            }}
          >
            Compare
          </TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="files">
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <SkillFilesPanel
              versionId={latestVersionId}
              readmeContent={readmeContent}
              readmeError={readmeError}
              latestFiles={latestFiles}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="compare">
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <SkillDiffCard skill={skill} versions={diffVersions ?? []} variant="embedded" />
          </Suspense>
        </TabsContent>

        <TabsContent value="versions">
          <SkillVersionsPanel
            versions={versions}
            nixPlugin={nixPlugin}
            skillSlug={skill.slug}
            suppressScanResults={suppressVersionScanResults}
            suppressedMessage={scanResultsSuppressedMessage}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}
