---
name: jubjub
description: Publish content across TikTok, Instagram, YouTube, LinkedIn and Vimeo. Manage team workflows, collaborate with your team, and track verified publish history.
version: 1.0.0
requires:
  env:
    - JUBJUB_API_KEY
primaryEnv: JUBJUB_API_KEY
---

# JubJub — SKILL.md

## 1. OVERVIEW

JubJub is a content publishing and team collaboration platform for creators. It lets users create workspaces, upload video content, collaborate with team members through threaded messaging and notifications, and publish content across multiple social platforms — TikTok, Instagram, YouTube, LinkedIn, and Vimeo — from a single workflow. Every publish action creates a verified on-chain record on Base, giving creators immutable proof of ownership and publish history. The platform supports team-based workflows with role-based access, shared credentials, workspace membership, and approval flows for launches.

## 2. AUTHENTICATION

Authenticate using an API key passed as a request header.

- **Get your key:** jubjubapp.com → Profile → Agents → Create New Agent
- **Header:** `X-JubJub-Agent-Key: jjagent_YOUR_KEY`
- **Base URL:** `https://api.jubjubapp.com`

All endpoints below are relative to the base URL unless an absolute path is shown.

## 3. ENDPOINTS

### Workspaces & Teams

#### Workspaces

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/workspaces` | Create a new workspace |
| | **Required:** `name` (string) | |
| | **Optional:** `description` (string), `team_id` (string) | |
| GET | `/v2/workspaces` | List workspaces for current user |
| | **Optional:** `team_id` (query, string), `role` (query, string), `limit` (query, int, default 50), `offset` (query, int, default 0) | |
| GET | `/v2/workspaces/{workspace_id}` | Get workspace details |
| | **Required:** `workspace_id` (path, string) | |
| PATCH | `/v2/workspaces/{workspace_id}` | Update workspace name or description |
| | **Required:** `workspace_id` (path, string) | |
| | **Optional:** `name` (string), `description` (string) | |
| DELETE | `/v2/workspaces/{workspace_id}` | Delete a workspace |
| | **Required:** `workspace_id` (path, string) | |
| POST | `/v2/workspaces/{workspace_id}/members` | Add a member to workspace |
| | **Required:** `workspace_id` (path, string), `profile_id` (body, string), `role` (body, string) | |
| GET | `/v2/workspaces/{workspace_id}/members` | List workspace members |
| | **Required:** `workspace_id` (path, string) | |
| PATCH | `/v2/workspaces/{workspace_id}/members/{member_id}` | Update member role |
| | **Required:** `workspace_id` (path, string), `member_id` (path, string), `role` (body, string) | |
| DELETE | `/v2/workspaces/{workspace_id}/members/{member_id}` | Remove a workspace member |
| | **Required:** `workspace_id` (path, string), `member_id` (path, string) | |
| GET | `/v2/workspaces/{workspace_id}/stats` | Get workspace statistics |
| | **Required:** `workspace_id` (path, string) | |
| POST | `/v2/workspaces/batch-delete` | Delete multiple workspaces |
| | **Required:** `workspace_ids` (body, list[string]) | |

#### Teams

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/teams` | Create a new team |
| | **Required:** `name` (body, string) | |
| | **Optional:** `description` (body, string) | |
| GET | `/v2/teams` | List teams for current user |
| | **Optional:** `limit` (query, int, default 50), `offset` (query, int, default 0) | |
| GET | `/v2/teams/{team_id}` | Get team details |
| | **Required:** `team_id` (path, string) | |
| PATCH | `/v2/teams/{team_id}` | Update team name or description |
| | **Required:** `team_id` (path, string) | |
| | **Optional:** `name` (string), `description` (string) | |
| DELETE | `/v2/teams/{team_id}` | Delete a team |
| | **Required:** `team_id` (path, string) | |
| POST | `/v2/teams/{team_id}/members` | Add a team member |
| | **Required:** `team_id` (path, string), `profile_id` (body, string), `role` (body, string) | |
| GET | `/v2/teams/{team_id}/members` | List team members |
| | **Required:** `team_id` (path, string) | |
| PATCH | `/v2/teams/{team_id}/members/{member_id}` | Update member role |
| | **Required:** `team_id` (path, string), `member_id` (path, string), `role` (body, string) | |
| DELETE | `/v2/teams/{team_id}/members/{member_id}` | Remove a team member |
| | **Required:** `team_id` (path, string), `member_id` (path, string) | |
| POST | `/v2/teams/{team_id}/transfer-ownership` | Transfer team ownership |
| | **Required:** `team_id` (path, string), `new_owner_id` (body, string) | |
| GET | `/v2/teams/{team_id}/stats` | Get team statistics |
| | **Required:** `team_id` (path, string) | |
| GET | `/v2/teams/with-workspaces` | List teams with their workspaces |
| | **Optional:** `limit` (query, int, default 50), `offset` (query, int, default 0) | |

#### Team Invites

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/teams/{team_id}/invites` | Invite someone to a team by email |
| | **Required:** `team_id` (path, string), `invitee_email` (body, string), `role` (body, string) | |
| GET | `/v2/teams/{team_id}/invites` | List invitations for a team |
| | **Required:** `team_id` (path, string) | |
| | **Optional:** `status` (query, string) | |
| GET | `/v2/invites/pending` | List pending invites for current user |
| POST | `/v2/invites/{invite_id}/accept` | Accept a team invitation |
| | **Required:** `invite_id` (path, string) | |
| POST | `/v2/invites/{invite_id}/reject` | Reject a team invitation |
| | **Required:** `invite_id` (path, string) | |

#### Shared Credentials

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/teams/{team_id}/credentials/share` | Share a platform credential with team |
| | **Required:** `team_id` (path, string), `credential_id` (body, string) | |
| | **Optional:** `can_revoke` (body, bool) | |
| GET | `/v2/teams/{team_id}/credentials` | List team's shared credentials |
| | **Required:** `team_id` (path, string) | |
| | **Optional:** `active_only` (query, bool) | |
| POST | `/v2/teams/{team_id}/credentials/{shared_credential_id}/revoke` | Revoke a shared credential |
| | **Required:** `team_id` (path, string), `shared_credential_id` (path, string) | |
| GET | `/v2/teams/{team_id}/credentials/available` | List credentials available to share |
| | **Required:** `team_id` (path, string) | |

### Content

#### Content Items

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/contents` | Create a new content item |
| | **Required:** `workspace_id` (body, string), `title` (body, string), `video_id` (body, string) | |
| | **Optional:** `description` (body, string), `thumbnail_id` (body, string), `folder_id` (body, string), `tags` (body, list[string]), `language` (body, string), `is_made_for_kids` (body, bool) | |
| GET | `/v2/contents` | List content items in a workspace |
| | **Required:** `workspace_id` (query, string) | |
| | **Optional:** `status` (query, string: "draft"\|"publishing"\|"published"), `folder_id` (query, string), `limit` (query, int, default 50), `offset` (query, int, default 0) | |
| GET | `/v2/contents/{content_id}` | Get content details |
| | **Required:** `content_id` (path, string) | |
| PATCH | `/v2/contents/{content_id}` | Update content fields |
| | **Required:** `content_id` (path, string) | |
| | **Optional:** `title` (string), `description` (string), `tags` (list[string]), `video_id` (string), `thumbnail_id` (string), `folder_id` (string), `language` (string), `is_made_for_kids` (bool), `status` (string) | |
| DELETE | `/v2/contents/{content_id}` | Delete content and associated resources |
| | **Required:** `content_id` (path, string) | |
| | **Optional:** `force` (query, bool) | |
| GET | `/v2/contents/{content_id}/full` | Get content with all platform configurations |
| | **Required:** `content_id` (path, string) | |
| | **Optional:** `expand` (query, string: "media") | |
| POST | `/v2/contents/{content_id}/targets` | Add platform targets to content |
| | **Required:** `content_id` (path, string), `credential_ids` (body, list[string]) | |
| GET | `/v2/contents/{content_id}/targets` | List platform targets for content |
| | **Required:** `content_id` (path, string) | |
| DELETE | `/v2/contents/{content_id}/targets/{credential_id}` | Remove a platform target |
| | **Required:** `content_id` (path, string), `credential_id` (path, string) | |
| POST | `/v2/contents/{content_id}/validate-configs` | Validate platform configurations |
| | **Required:** `content_id` (path, string) | |
| | **Optional:** `config_ids` (body, list[string]) | |
| POST | `/v2/contents/{content_id}/apply-general-settings` | Apply content settings to platform configs |
| | **Required:** `content_id` (path, string), `fields` (body, list[string]) | |
| | **Optional:** `config_ids` (body, list[string]), `overwrite_custom` (body, bool) | |

#### Media

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/media/upload/request` | Get a signed URL for direct media upload |
| | **Required:** `filename` (body, string), `workspace_id` (body, string) | |
| | **Optional:** `content_type` (body, string) | |
| POST | `/v2/media/{media_id}/upload/complete` | Confirm upload completion |
| | **Required:** `media_id` (path, string) | |
| GET | `/v2/media` | List media in a workspace |
| | **Required:** `workspace_id` (query, string) | |
| | **Optional:** `media_type` (query, string), `status` (query, string), `limit` (query, int, default 50), `offset` (query, int, default 0) | |
| GET | `/v2/media/{media_id}` | Get media details |
| | **Required:** `media_id` (path, string) | |
| DELETE | `/v2/media/{media_id}` | Delete media |
| | **Required:** `media_id` (path, string) | |
| POST | `/v2/media/bulk-rename` | Bulk rename media files |
| | **Required:** `renames` (body, list[object] — each with `media_id` (string) and `new_filename` (string)) | |
| POST | `/v2/media/ingest-url` | Ingest media from a public URL |
| | **Required:** `url` (body, string), `workspace_id` (body, string) | |
| | **Optional:** `filename` (body, string) | |

#### Upload Sessions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/uploads/link` | Create an upload session link (returns a URL for browser-based upload) |
| | **Required:** `workspace_id` (body, string) | |
| GET | `/v2/uploads/sessions/{id}` | Get upload session status and groupings |
| | **Required:** `id` (path, string) | |
| POST | `/v2/uploads/sessions/{id}/infer-groupings` | Infer content groupings from uploaded files |
| | **Required:** `id` (path, string) | |
| POST | `/v2/uploads/sessions/{id}/confirm-groupings` | Confirm inferred groupings |
| | **Required:** `id` (path, string), `groupings` (body, list[object]) | |

#### Credentials

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/credentials` | List all connected platform credentials |
| GET | `/v2/credentials/by-platform` | List credentials grouped by platform |
| POST | `/v2/credentials/oauth/{platform}/initiate` | Initiate OAuth flow for a platform |
| | **Required:** `platform` (path, string) | |
| POST | `/v2/credentials/oauth/{platform}/callback` | Handle OAuth callback |
| | **Required:** `platform` (path, string) | |
| PATCH | `/v2/credentials/{credential_id}` | Update a credential |
| | **Required:** `credential_id` (path, string) | |
| DELETE | `/v2/credentials/{credential_id}` | Delete a credential |
| | **Required:** `credential_id` (path, string) | |

### Publishing

#### Platform Configs

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/platform-configs` | Create a platform configuration for content |
| | **Required:** `content_id` (body, string), `platform` (body, string), `credential_id` (body, string) | |
| | **Optional:** `settings` (body, object) | |
| GET | `/v2/platform-configs` | List platform configs for a content item |
| | **Required:** `content_id` (query, string) | |
| | **Optional:** `status` (query, string), `limit` (query, int, default 50), `offset` (query, int, default 0) | |
| GET | `/v2/platform-configs/{config_id}` | Get platform config details |
| | **Required:** `config_id` (path, string) | |
| PATCH | `/v2/platform-configs/{config_id}` | Update platform config settings |
| | **Required:** `config_id` (path, string), `settings` (body, object) | |
| | **Optional:** `status` (body, string) | |
| DELETE | `/v2/platform-configs/{config_id}` | Delete a platform config |
| | **Required:** `config_id` (path, string) | |
| POST | `/v2/platform-configs/bulk/create` | Bulk create platform configs |
| | **Required:** `content_id` (body, string), `configs` (body, list[object]) | |
| POST | `/v2/platform-configs/bulk/update` | Bulk update platform configs |
| | **Required:** `config_ids` (body, list[string]), `settings` (body, object) | |
| GET | `/v2/platform-configs/schemas/all` | Get all platform requirement schemas |
| GET | `/v2/platform-configs/requirements/{platform}` | Get requirements for a specific platform |
| | **Required:** `platform` (path, string) | |

#### Platform Defaults

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/platform-defaults/{credential_id}` | Load saved default settings for a credential |
| | **Required:** `credential_id` (path, string) | |
| PUT | `/v2/platform-defaults/{credential_id}` | Save default settings for a credential |
| | **Required:** `credential_id` (path, string), `settings` (body, object) | |
| DELETE | `/v2/platform-defaults/{credential_id}` | Remove saved defaults for a credential |
| | **Required:** `credential_id` (path, string) | |

#### Launches

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/launches` | Create a launch (publish or schedule content) |
| | **Required:** `content_id` (body, string), `platform_config_ids` (body, list[string]) | |
| | **Optional:** `scheduled_for` (body, string — ISO 8601 datetime with timezone offset) | |
| GET | `/v2/launches` | List launches |
| | **Optional:** `workspace_id` (query, string), `workspace_ids` (query, list[string]), `status` (query, string), `limit` (query, int, default 50), `offset` (query, int, default 0) | |
| GET | `/v2/launches/{launch_id}` | Get launch details including per-platform status |
| | **Required:** `launch_id` (path, string) | |
| POST | `/v2/launches/{launch_id}/validate` | Validate launch readiness before executing |
| | **Required:** `launch_id` (path, string) | |
| | **Optional:** `platform_config_ids` (body, list[string]) | |
| POST | `/v2/launches/{launch_id}/execute` | Execute a pending launch immediately |
| | **Required:** `launch_id` (path, string) | |
| POST | `/v2/launches/{launch_id}/retry` | Retry a failed launch |
| | **Required:** `launch_id` (path, string) | |
| | **Optional:** `platform_launch_ids` (body, list[string]) | |
| DELETE | `/v2/launches/{launch_id}` | Cancel a scheduled launch |
| | **Required:** `launch_id` (path, string) | |

#### Approvals

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/approvals/{approval_id}/decide` | Approve or reject a launch approval request |
| | **Required:** `approval_id` (path, string), `decision` (body, string: "approved"\|"rejected") | |
| | **Optional:** `reason` (body, string) | |
| GET | `/v2/approvals/pending` | List pending approvals for current user |
| GET | `/v2/approvals/launch/{launch_id}` | List approvals for a specific launch |
| | **Required:** `launch_id` (path, string) | |

### Collaboration

#### Collections

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/collections` | Create a collection |
| | **Required:** `workspace_id` (body, string), `name` (body, string) | |
| | **Optional:** `description` (body, string) | |
| GET | `/v2/collections` | List collections in a workspace |
| | **Required:** `workspace_id` (query, string) | |
| GET | `/v2/collections/{collection_id}` | Get collection details |
| | **Required:** `collection_id` (path, string) | |

#### Communication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/communication` | Create a message in a workspace or content scope |
| | **Required:** `scope_type` (body, string), `scope_id` (body, string), `body` (body, string) | |
| | **Optional:** `parent_message_id` (body, string), `thread_root_id` (body, string), `message_type` (body, string), `decision_type` (body, string), `mentions` (body, list[object]), `metadata` (body, object) | |
| GET | `/v2/communication` | List messages by scope |
| | **Required:** `scope_type` (query, string), `scope_id` (query, string) | |
| | **Optional:** `cursor` (query, string), `limit` (query, int, default 50), `thread_root_id` (query, string), `collection_id` (query, string) | |
| GET | `/v2/communication/{message_id}` | Get a single message |
| | **Required:** `message_id` (path, string) | |
| PATCH | `/v2/communication/{message_id}` | Edit a message |
| | **Required:** `message_id` (path, string) | |
| | **Optional:** `body` (string), `mentions` (list[object]), `metadata` (object) | |
| DELETE | `/v2/communication/{message_id}` | Soft-delete a message |
| | **Required:** `message_id` (path, string) | |
| PATCH | `/v2/communication/{message_id}/resolve` | Resolve a decision message |
| | **Required:** `message_id` (path, string), `decision_status` (body, string) | |
| | **Optional:** `resolution` (body, string) | |

#### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/notifications` | List notifications for current user |
| | **Optional:** `cursor` (query, string), `limit` (query, int, default 50), `unread_only` (query, bool) | |
| GET | `/v2/notifications/{notification_id}` | Get notification details |
| | **Required:** `notification_id` (path, string) | |
| POST | `/v2/notifications/{notification_id}/mark-read` | Mark a notification as read |
| | **Required:** `notification_id` (path, string) | |
| POST | `/v2/notifications/mark-all-read` | Mark all notifications as read |
| DELETE | `/v2/notifications/{notification_id}` | Delete a notification |
| | **Required:** `notification_id` (path, string) | |

#### Profiles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v2/profiles` | Batch lookup user profiles by IDs |
| | **Required:** `ids` (query, string — comma-separated profile IDs, max 50) | |

## 4. EXAMPLE PROMPTS

1. "Publish my latest video to TikTok and Instagram at 3pm EST tomorrow."
2. "Create a new workspace called 'March Campaign' for my marketing team."
3. "Send a message to the Spring Launch workspace saying the video is ready for review."
4. "What's the status of my last launch?"
5. "List all my workspaces."
6. "Create a content item in my Product Demos workspace with the title 'New Feature Walkthrough'."
7. "Show me all pending approvals I need to review."
8. "Schedule this video to YouTube and LinkedIn for next Monday at 9am PST."
9. "Check my unread notifications."
10. "Add jamie@example.com to my content team as an editor."

## 5. NOTES

- A content item requires a `video_id` from an uploaded media file. Upload media first via `/v2/media/upload/request` or `/v2/media/ingest-url`, then reference the returned `media_id` as the `video_id` when creating content.
- Platform credentials must be connected in JubJub before publishing to that platform. Use `GET /v2/credentials` to check connected accounts. Users connect new platforms via OAuth at jubjubapp.com.
- A launch requires at least one platform config. Create a content item, then create platform configs linking it to credentials, then create the launch referencing those platform config IDs.
- Always call `POST /v2/launches/{launch_id}/validate` before executing a launch to verify readiness.
- The `scheduled_for` datetime in launch creation must include a timezone offset (e.g., `2026-03-15T15:00:00-05:00`). Naive datetimes default to UTC.
- Each content item maps to one publishing event. To publish the same video with different settings per platform, create separate platform configs on the same content item.
- Upload sessions (`/v2/uploads/link`) produce a browser URL — the user must open it and upload files manually. Poll `/v2/uploads/sessions/{id}` until groupings are inferred, then use the `video_media_id` from groupings as the `video_id` for content creation.
- The `platform` field in platform config creation accepts: `youtube`, `instagram`, `tiktok`, `linkedin`, `vimeo`.
- Agent API keys can be scoped with specific permissions. Check your key's scopes if you receive 403 errors.
