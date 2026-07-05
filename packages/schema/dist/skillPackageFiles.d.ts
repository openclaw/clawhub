export type SkillPackageFileCaseCollision = {
    canonicalName: string;
    paths: string[];
};
export declare function findSkillPackageFileCaseCollisions(filePaths: Iterable<string>): SkillPackageFileCaseCollision[];
export declare function formatSkillPackageFileCaseCollisionError(collisions: readonly SkillPackageFileCaseCollision[]): string;
