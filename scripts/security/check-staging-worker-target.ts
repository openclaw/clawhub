import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export async function checkStagingWorkerTarget(
  env: NodeJS.ProcessEnv = process.env,
  readBuildSha = async (url: string) => {
    const client = new ConvexHttpClient(url);
    return (await client.query(api.appMeta.getDeploymentInfo, {})).appBuildSha;
  },
) {
  if (
    env.GITHUB_REPOSITORY !== "openclaw/clawhub" ||
    env.GITHUB_REF !== "refs/heads/staging" ||
    env.CONVEX_URL !== "https://cheery-civet-733.convex.cloud" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  ) {
    throw new Error("Staging workers require the staging branch and cheery-civet-733 backend");
  }
  if ((await readBuildSha(env.CONVEX_URL)) !== env.GITHUB_SHA) {
    throw new Error("Deploy this staging commit before running its workers");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkStagingWorkerTarget();
  console.log("Verified staging worker target: cheery-civet-733 at this workflow SHA");
}
