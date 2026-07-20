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

Completed items do not count toward the active-item maximum. A board can configure a lower Max active items per list value as a working constraint. API input cannot configure a value above 20. An explicit override can bypass only the lower working constraint, never the Pro maximum.

All resource limits are enforced transactionally on the server for browser, CLI, idempotent, and agent requests. UI checks explain obvious over-limit actions but are not an authorization boundary. Every query and mutation continues to scope resources to the authenticated account owner.
