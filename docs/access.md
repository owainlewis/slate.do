# Access model

Slate keeps application authority separate from paid membership.

## Roles

- `admin` is an operator role. Admins can use and administer the app without a paid membership.
- `member` is the default role for future public sign-ups. A member's role does not imply paid access.

The `seed-admin` command creates a named admin account. It is idempotent for the same email and does not promote an existing member silently. More than one named admin may exist.

## Future membership and Stripe

Follow the Passage billing shape when paid access is added:

1. Store commercial state separately from `users.role`, in a billing account keyed by user ID.
2. Resolve a server-owned entitlement such as `free` or `paid` from an explicit override, admin access, and Stripe subscription state.
3. Treat active and trialing Stripe subscriptions as paid. Webhooks remain the durable source of subscription state.
4. Enforce paid features on the server. UI checks only explain the current entitlement.
5. Put checkout, portal, and webhooks behind a disabled-by-default billing configuration until all Stripe secrets and price IDs are set.

Public registration, Stripe checkout, billing webhooks, and paid feature limits are intentionally outside the current admin-account task.
