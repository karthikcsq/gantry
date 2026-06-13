# join-existing-venture

**Target:** Build a "join existing venture" feature on the onboarding form when users are asked to set up their venture.

## Pseudocode
1. User opens onboarding form
2. See a search bar with text "join existing venture" beside
3. Search for existing venture / name of user in venture
<!-- gantry:item id=gty-001 type=ref status=accept mode=decision -->
   - [x] **ref:** [accept] existing `/api/ventures/search` searches users, not ventures; add or reuse an endpoint that returns active ventures searchable by venture name and member name.
4. Click on venture in dropdown that appears (dropdown is scrollable)
<!-- gantry:item id=gty-002 type=edge status=edit mode=decision -->
   - [x] **edge:** [edit] if the same query matches multiple ventures or multiple users on different ventures, the dropdown should show enough venture/member context for the user to choose the intended venture;
  - comment: show a brief venture description underneath, with a card large enough to accommodate it.
5. click join button that appears after selecting venture.
<!-- gantry:item id=gty-003 type=edge status=accept mode=decision -->
   - [x] **edge:** [accept] joining should create a pending invite/request instead of immediately adding any eligible onboarding user to the selected venture.
<!-- gantry:item id=gty-004 type=ripple status=accept mode=decision -->
   - [x] **ripple:** [accept] add a new join-request model/API, separate from `VentureInvite`, because the existing invite model is addressed to one invited user while this request is addressed to a venture/member approval queue.
6. Assigns user as teammate on venture.
<!-- gantry:item id=gty-005 type=ripple status=accept mode=decision -->
   - [x] **ripple:** [accept] current membership write paths are create/update intake, member-initiated add-member, and member-initiated invite; onboarding self-join needs a new authorized server path or a changed intake API mode that assigns `currentUser.ventureId` to the selected active venture.
<!-- gantry:item id=gty-006 type=edge status=accept mode=decision -->
   - [x] **edge:** [accept] if the user already has a venture when they submit join, show a confirmation popup: "You are currently in a venture: <Venture Name>. Would you like to leave the venture?" If confirmed, continue.
## Code (as written 2026-06-10 @ e611f0586364461b90cb71ed9519839c27e6c9b3)

Implemented in:

- `prisma/schema.prisma`
- `prisma/migrations/add_venture_join_requests.sql`
- `src/app/api/ventures/search-existing/route.ts`
- `src/app/api/ventures/join-requests/route.ts`
- `src/app/api/ventures/join-requests/approve/route.ts`
- `src/app/api/ventures/join-requests/decline/route.ts`
- `src/app/venture/intake/IntakeForm.tsx`
- `src/app/venture/edit/VentureEditForm.tsx`

Behavior written:

- Adds a separate `VentureJoinRequest` model and `VentureJoinRequestStatus` enum for applicant-initiated requests.
- Adds authenticated active-venture search at `GET /api/ventures/search-existing?q=...`, matching venture name, description, and current member names.
- Adds `GET /api/ventures/join-requests` for current venture members to list pending requests.
- Adds `POST /api/ventures/join-requests` for onboarding users to request joining an active venture, including the approved confirmation path for leaving an existing venture before creating the request.
- Adds `POST /api/ventures/join-requests/approve` for current venture members to approve a request, assign the requester to the venture, elevate student cohort status using the existing team-status rule, archive an old empty venture if needed, approve the handled request, and decline the requester's other pending join requests.
- Adds `POST /api/ventures/join-requests/decline` for current venture members to decline a pending request.
- Adds a "Join Existing Venture" search section to `/venture/intake` with scrollable result cards, venture descriptions, member context, selected-venture join button, success/error states, and the approved existing-venture confirmation popup.
- Adds a "Join Requests" review section to `/venture/edit` so venture members can approve or decline pending requests from the team management card.
