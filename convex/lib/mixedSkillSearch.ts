export type MixedSkillSource = "native" | "skills-sh";

export type MixedSkillCandidate<T> = {
  key: string;
  value: T;
  source: MixedSkillSource;
  rankTier: number;
  textScore: number;
  clawhubTrusted: boolean;
  popularity: number;
  freshness: number;
};

type MixedSkillLoadOptions<TNative, TExternal> = {
  loadNative: (limit: number) => Promise<MixedSkillCandidate<TNative>[]>;
  loadExternal: (limit: number) => Promise<MixedSkillCandidate<TExternal>[]>;
  nativeLimit: number;
  externalLimit: number;
  resultLimit: number;
};

function compareMixedSkillCandidates<T>(a: MixedSkillCandidate<T>, b: MixedSkillCandidate<T>) {
  return (
    a.rankTier - b.rankTier ||
    Number(b.clawhubTrusted) - Number(a.clawhubTrusted) ||
    b.textScore - a.textScore ||
    b.popularity - a.popularity ||
    b.freshness - a.freshness ||
    a.key.localeCompare(b.key)
  );
}

export function rankMixedSkillCandidates<T>(candidates: MixedSkillCandidate<T>[]) {
  return [...candidates].sort(compareMixedSkillCandidates);
}

export async function loadAndRankMixedSkillCandidates<TNative, TExternal>(
  options: MixedSkillLoadOptions<TNative, TExternal>,
) {
  const nativeLimit = Math.max(0, options.nativeLimit);
  const externalLimit = Math.max(0, options.externalLimit);
  const resultLimit = Math.max(0, options.resultLimit);
  const [nativeCandidates, externalCandidates] = await Promise.all([
    options.loadNative(nativeLimit),
    options.loadExternal(externalLimit),
  ]);
  const bounded: MixedSkillCandidate<TNative | TExternal>[] = [
    ...nativeCandidates.slice(0, nativeLimit),
    ...externalCandidates.slice(0, externalLimit),
  ];
  return rankMixedSkillCandidates(bounded).slice(0, resultLimit);
}
