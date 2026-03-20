export type Lockfile = {
  version: 1;
  skills: Record<
    string,
    {
      version: string | null;
      installedAt: number;
    }
  >;
};
