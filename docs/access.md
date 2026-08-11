# Access model

Slate keeps application authority separate from product access. Every account resolves to a server-owned Free or Pro plan.

## Roles

- `admin` is an operator role.
- `member` is the default role for future public sign-ups.

Neither role is a plan. A member without an entitlement row resolves to Free. Admin, invite, manual, and future Stripe grants resolve to Pro.

The `seed-admin` command creates a named admin account and grants Pro with the `admin` source. It is idempotent for the same email and does not promote an existing member silently. More than one named admin may exist. The Pro migration grants the same entitlement to every existing admin, so those accounts remain usable.

## Plans and grants

`entitlements` records explicit Pro grants and how access was granted:

- `invite_code`
- `stripe`
- `manual`
- `admin`

Free is the default and does not require an entitlement row. There is one paid plan, Pro. Stripe behavior is not implemented here.

Invite-code registration creates `member` accounts with the same `pro` plan and records `invite_code` only as the entitlement source. The shared admission code is not stored with the account and is not needed for later sign-in.

The authenticated user response exposes the resolved plan, grant source, server-owned limits, and measured usage:

| Limit | Free | Pro |
| --- | ---: | ---: |
| Boards | 1 | 5 |
| Lists per board | 5 | 9 |
| Legacy active-item setting | 20 | 20 |
| Active agents | 1 | 5 |
| Stored tasks | 500 | 10,000 |
| Stored content | 10 MiB | 250 MiB |
| API tokens | 3 | 20 |

Usage reports boards, the largest list count on a board, the largest active-item count on a list, active agents, all stored tasks, stored-content bytes, and active API tokens. Content is measured as UTF-8 bytes from task titles, task descriptions, and card conversation bodies, including human comments and agent outputs.

The active-item value remains in entitlement and board responses for compatibility, but task creation, reopening, and movement do not enforce it. Lists organise work and account-level stored-task and content quotas provide the capacity boundary. The legacy override flag is accepted and ignored.

Board, list, active-agent, stored-task, stored-content, and API-token limits are enforced transactionally on the server. Every query and mutation continues to scope resources to the authenticated account owner.

## Request and text limits

Every JSON mutation request is limited to 64 KiB before decoding. Oversized bodies return HTTP 413 with `request_body_too_large`. Invalid JSON returns HTTP 400 with `invalid_json`. Stored text is checked at the API boundary for browser, CLI, human API-token, and agent-token requests:

| Field | Maximum | Measurement |
| --- | ---: | --- |
| Task title | 300 | Unicode characters |
| Task description | 16 KiB | UTF-8 bytes |
| Card comment or output body | 16 KiB | UTF-8 bytes |
| Board name | 100 | Unicode characters |
| Board background kind | 32 | Unicode characters |
| Board background value | 100 | Unicode characters |
| List name | 100 | Unicode characters |
| List goal | 4 KiB | UTF-8 bytes |
| Agent name | 100 | Unicode characters |
| Agent purpose or instructions | 4 KiB | UTF-8 bytes |
| API token name | 80 | Unicode characters |
| Account display name | 80 | Unicode characters |
| Account email | 254 | UTF-8 bytes and a valid email address |
| Task idempotency key | 200 | UTF-8 bytes |
| Agent credential-rotation key | 128 | UTF-8 bytes |

An oversized field returns HTTP 400 with `field_too_long`, the JSON field name, limit, and measurement unit. Responses never echo submitted content. Existing reads do not apply these write limits, and partial updates validate only fields included in that request.

## Agent identities and credentials

An account owner can create named agent identities without an email, password, registration, or browser session. Identity and credential lifecycle are separate:

- An `agents` row is the durable identity. Its immutable ID owns every task assignment. It has a name, an optional purpose, archive state, and timestamps.
- An `agent_credentials` row authenticates one identity. It contains a SHA-256 token hash, a safe display prefix when available, last-used and revoked times, and timestamps. The database permits at most one active credential per agent.

Creation returns one plaintext `slate_agent_...` token once. Slate stores only its SHA-256 hash and safe prefix. List and creation responses expose identity and credential state but never a token hash. Credentials migrated from the earlier combined model have no display prefix because the plaintext token cannot be recovered from its hash.

An agent token resolves to its owning account and immutable agent ID for assigned-work authorization. Agent credentials can read board and list metadata only when the board or list contains work assigned to that agent. These metadata responses do not include nested tasks. Agent credentials cannot use account-level board or list creation, editing, deletion, or reordering routes, or general task create, reorder, move, and delete routes. Supported general task reads and updates are always restricted to that agent's assignments. An agent cannot read, claim, or mutate another agent's assigned work, even when both agents belong to the same account. Claim and status changes remain atomic.

Free permits one active agent and Pro permits five. Archived agents do not consume the limit. Active names are stored trimmed and must be unique per account using case-insensitive comparison. Creation locks the account while checking the plan limit, so concurrent requests cannot exceed it.

Revoking a credential leaves the agent identity and assignments intact, and the active identity still consumes a Pro slot. Archiving an agent also revokes its active credential, removes the identity from future assignment choices, and frees the slot. Existing assignments keep the archived identity so task history remains understandable. Existing live, revoked, and deleted agent records migrate without changing identity IDs; deleted records become archived identities and no migration creates or logs plaintext credentials.

Slate does not currently have a vetted image upload or object-storage pipeline. Primary users and agent identities therefore use deterministic initials-and-colour avatars derived from their stored identity. Display names are escaped before rendering. Uploaded files and external avatar URLs are intentionally unsupported until image validation, processing, scanning, and durable storage are designed.
