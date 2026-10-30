---
name: Access policy
description: User's intended authorization scope for this internal app.
---

Limit access to the explicitly listed Clerk users, not organization membership.

**Why:** The user chose “Use listed users only” and reiterated “we use user level”
when organization setup requirements continued to appear. Organization-wide
access and organization configuration requirements are not intended.

**How to apply:** Preserve user-only authorization in future configuration and
authentication work. Do not add organization-based access without a new request.
