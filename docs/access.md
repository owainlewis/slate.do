# Access model

Slate keeps application authority separate from product access. Every account that can use the app has one server-owned `pro` entitlement.

## Roles

- `admin` is an operator role.
- `member` is the default role for future public sign-ups.

Neither role is a plan. A user is usable only when the server resolves a separate Pro entitlement.

The `seed-admin` command creates a named admin account and grants Pro with the `admin` source. It is idempotent for the same email and does not promote an existing member silently. More than one named admin may exist. The Pro migration grants the same entitlement to every existing admin, so those accounts remain usable.

## Pro entitlement

`entitlements` records the user, the single `pro` plan, and how access was granted:

- `invite_code`
- `stripe`
- `manual`
- `admin`

There is no Free tier, `beta_pro`, or second paid plan. Stripe behavior is not implemented here.

Invite-code registration creates `member` accounts with the same `pro` plan and records `invite_code` only as the entitlement source. The shared admission code is not stored with the account and is not needed for later sign-in.

The authenticated user response exposes the resolved plan, source, and the server-owned Pro limits:

- 5 boards per account.
- 9 lists per board.
- Max active items per list: 20.
- 5 active agents per account.

Completed items do not count toward the active-item maximum. A board can configure a lower Max active items per list value as a working constraint. API input cannot configure a value above 20. An explicit override can bypass only the lower working constraint, never the Pro maximum.

All resource limits are enforced transactionally on the server for browser, CLI, idempotent, and agent requests. UI checks explain obvious over-limit actions but are not an authorization boundary. Every query and mutation continues to scope resources to the authenticated account owner.

## Agent identities and credentials

An account owner can create named agent identities without an email, password, registration, or browser session. Identity and credential lifecycle are separate:

- An `agents` row is the durable identity. Its immutable ID owns every task assignment. It has a name, an optional purpose, archive state, and timestamps.
- An `agent_credentials` row authenticates one identity. It contains a SHA-256 token hash, a safe display prefix when available, last-used and revoked times, and timestamps. The database permits at most one active credential per agent.

Creation returns one plaintext `slate_agent_...` token once. Slate stores only its SHA-256 hash and safe prefix. List and creation responses expose identity and credential state but never a token hash. Credentials migrated from the earlier combined model have no display prefix because the plaintext token cannot be recovered from its hash.

An agent token resolves to its owning account and immutable agent ID for assigned-work authorization. Agent credentials can read board and list metadata only when the board or list contains work assigned to that agent. These metadata responses do not include nested tasks. Agent credentials cannot use account-level board or list creation, editing, deletion, or reordering routes, or general task create, reorder, move, and delete routes. Supported general task reads and updates are always restricted to that agent's assignments. An agent cannot read, claim, or mutate another agent's assigned work, even when both agents belong to the same account. Claim and status changes remain atomic.

Pro permits five active agents. Archived agents do not consume the limit. Active names are stored trimmed and must be unique per account using case-insensitive comparison. Creation locks the account while checking the limit, so concurrent requests cannot exceed it.

Revoking a credential leaves the agent identity and assignments intact, and the active identity still consumes a Pro slot. Archiving an agent also revokes its active credential, removes the identity from future assignment choices, and frees the slot. Existing assignments keep the archived identity so task history remains understandable. Existing live, revoked, and deleted agent records migrate without changing identity IDs; deleted records become archived identities and no migration creates or logs plaintext credentials.

Slate does not currently have a vetted image upload or object-storage pipeline. Primary users and agent identities therefore use deterministic initials-and-colour avatars derived from their stored identity. Display names are escaped before rendering. Uploaded files and external avatar URLs are intentionally unsupported until image validation, processing, scanning, and durable storage are designed.
