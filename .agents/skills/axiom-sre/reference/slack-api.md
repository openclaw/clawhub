# Slack API Methods Reference

Complete method reference organized by category.

## chat.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `chat.postMessage` | Post message to channel | `chat:write` |
| `chat.postEphemeral` | Post ephemeral (only visible to one user) | `chat:write` |
| `chat.update` | Update existing message | `chat:write` |
| `chat.delete` | Delete message | `chat:write` |
| `chat.scheduleMessage` | Schedule message for later | `chat:write` |
| `chat.unfurl` | Provide custom unfurl behavior | `links:write` |

### chat.postMessage parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | ✓ | Channel ID, user ID, or conversation ID |
| `text` | string | ✓* | Message text (fallback if using blocks) |
| `blocks` | array | | Block Kit blocks for rich layouts |
| `thread_ts` | string | | Parent message ts for threading |
| `reply_broadcast` | bool | | Also post reply to channel |
| `unfurl_links` | bool | | Enable URL unfurling (default: true) |
| `unfurl_media` | bool | | Enable media unfurling (default: true) |
| `mrkdwn` | bool | | Enable markdown parsing (default: true) |
| `username` | string | | Override bot username (needs `chat:write.customize`) |
| `icon_emoji` | string | | Override icon with emoji |
| `icon_url` | string | | Override icon with URL |

## conversations.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `conversations.list` | List all channels | `channels:read`, `groups:read`, `im:read`, `mpim:read` |
| `conversations.info` | Get channel info | `channels:read` / `groups:read` |
| `conversations.history` | Get message history | `channels:history` / `groups:history` |
| `conversations.replies` | Get thread replies | `channels:history` / `groups:history` |
| `conversations.members` | List channel members | `channels:read` / `groups:read` |
| `conversations.create` | Create channel | `channels:manage` / `groups:write` |
| `conversations.archive` | Archive channel | `channels:manage` / `groups:write` |
| `conversations.unarchive` | Unarchive channel | `channels:manage` / `groups:write` |
| `conversations.rename` | Rename channel | `channels:manage` / `groups:write` |
| `conversations.join` | Join public channel | `channels:join` |
| `conversations.invite` | Invite users to channel | `channels:manage` / `groups:write` |
| `conversations.kick` | Remove user from channel | `channels:manage` / `groups:write` |
| `conversations.leave` | Leave channel | `channels:manage` / `groups:write` |
| `conversations.open` | Open/resume DM | `im:write` / `mpim:write` |
| `conversations.close` | Close DM | `im:write` / `mpim:write` |
| `conversations.mark` | Set read cursor | `channels:manage` / `groups:write` |
| `conversations.setPurpose` | Set channel purpose | `channels:manage` / `groups:write` |
| `conversations.setTopic` | Set channel topic | `channels:manage` / `groups:write` |

### conversations.list parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `types` | string | `public_channel` | Comma-separated: `public_channel`, `private_channel`, `mpim`, `im` |
| `exclude_archived` | bool | false | Exclude archived channels |
| `limit` | int | 100 | Max results (max 1000) |
| `cursor` | string | | Pagination cursor |
| `team_id` | string | | Required for org-level tokens |

## users.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `users.list` | List all users | `users:read` |
| `users.info` | Get user info | `users:read` |
| `users.lookupByEmail` | Find user by email | `users:read.email` |
| `users.getPresence` | Get user presence | `users:read` |
| `users.setPresence` | Set own presence | `users:write` |
| `users.profile.get` | Get user profile | `users.profile:read` |
| `users.profile.set` | Set user profile/status | `users.profile:write` |
| `users.setPhoto` | Set profile photo | `users.profile:write` |
| `users.deletePhoto` | Delete profile photo | `users.profile:write` |

### users.profile.set status fields

| Field | Type | Description |
|-------|------|-------------|
| `status_text` | string | Status text (max 100 chars) |
| `status_emoji` | string | Status emoji (e.g., `:calendar:`) |
| `status_expiration` | int | Unix timestamp when status expires (0 = never) |

## files.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `files.getUploadURLExternal` | Get upload URL (step 1) | `files:write` |
| `files.completeUploadExternal` | Complete upload (step 3) | `files:write` |
| `files.list` | List files | `files:read` |
| `files.info` | Get file info | `files:read` |
| `files.delete` | Delete file | `files:write` |
| `files.sharedPublicURL` | Create public URL | `files:write` |
| `files.revokePublicURL` | Revoke public URL | `files:write` |

**Note**: `files.upload` deprecated Nov 2025. Use the 3-step external upload flow.

## reactions.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `reactions.add` | Add emoji reaction | `reactions:write` |
| `reactions.remove` | Remove reaction | `reactions:write` |
| `reactions.get` | Get reactions on item | `reactions:read` |
| `reactions.list` | List user's reactions | `reactions:read` |

## dnd.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `dnd.setSnooze` | Start DND snooze | `dnd:write` |
| `dnd.endSnooze` | End DND snooze | `dnd:write` |
| `dnd.endDnd` | End DND session | `dnd:write` |
| `dnd.info` | Get own DND status | `dnd:read` |
| `dnd.teamInfo` | Get team DND statuses | `dnd:read` |

## pins.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `pins.add` | Pin item to channel | `pins:write` |
| `pins.remove` | Unpin item | `pins:write` |
| `pins.list` | List pinned items | `pins:read` |

## search.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `search.messages` | Search messages | `search:read` (user token only) |
| `search.files` | Search files | `search:read` (user token only) |
| `search.all` | Search all | `search:read` (user token only) |

## stars.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `stars.add` | Save item for later | `stars:write` |
| `stars.remove` | Remove saved item | `stars:write` |
| `stars.list` | List saved items | `stars:read` |

## team.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `team.info` | Get workspace info | `team:read` |
| `team.accessLogs` | Get access logs | `admin` |
| `team.billableInfo` | Get billable info | `admin` |

## bookmarks.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `bookmarks.add` | Add channel bookmark | `bookmarks:write` |
| `bookmarks.edit` | Edit bookmark | `bookmarks:write` |
| `bookmarks.list` | List bookmarks | `bookmarks:read` |
| `bookmarks.remove` | Remove bookmark | `bookmarks:write` |

## auth.*

| Method | Description | Scopes |
|--------|-------------|--------|
| `auth.test` | Test token validity | Any |
| `auth.revoke` | Revoke token | Any |

## Rate Limits

| Tier | Rate | Methods |
|------|------|---------|
| Tier 1 | 1/min | Special methods |
| Tier 2 | 20/min | Most read methods |
| Tier 3 | 50/min | Most write methods |
| Tier 4 | 100/min | High-volume methods |
| Special | 1/sec/channel | `chat.postMessage` |

When rate limited, response includes `Retry-After` header.
