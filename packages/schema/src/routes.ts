export const LegacyApiRoutes = {
  download: '/api/download',
  search: '/api/search',
  skill: '/api/skill',
  skillResolve: '/api/skill/resolve',
  cliWhoami: '/api/cli/whoami',
  cliUploadUrl: '/api/cli/upload-url',
  cliPublish: '/api/cli/publish',
  cliTelemetrySync: '/api/cli/telemetry/sync',
  cliSkillDelete: '/api/cli/skill/delete',
  cliSkillUndelete: '/api/cli/skill/undelete',
} as const

export const ApiRoutes = {
  search: '/api/v1/search',
  resolve: '/api/v1/resolve',
  download: '/api/v1/download',
  skills: '/api/v1/skills',
  stars: '/api/v1/stars',
  souls: '/api/v1/souls',
  users: '/api/v1/users',
  whoami: '/api/v1/whoami',
} as const
