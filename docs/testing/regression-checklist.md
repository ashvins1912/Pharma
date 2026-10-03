# Separation regression checklist

The file organization and independent process checks do not replace full
workflow regression against configured databases, Supabase, WhatsApp, and
delivery integrations. Check an item only after validating it in the target
deployment.

- [ ] Login/logout, Supabase session refresh, demo access, and MFA
- [ ] Customer and administrator dashboards
- [ ] Medicine catalog search and search impression recording
- [ ] Product discovery/data-mart results
- [ ] Medicine Request creation and pharmacy review
- [ ] Proposal creation, customer approval/rejection, and conversion to Order
- [ ] Order creation, list/detail/history, status change, and cancellation
- [ ] Checkout quote, coupon, loyalty points, and order pricing snapshot
- [ ] Prescription upload, ownership validation, download, and cleanup
- [ ] Inventory availability, adjustment, and import failure reports
- [ ] Inventory reservation, release, and deduction
- [ ] Automatic rider assignment and manual assignment fallback
- [ ] Rider alert contents and admin assignment alerts
- [ ] Dispatch and delivery status behavior
- [ ] WhatsApp order placement, ready, assignment, dispatch, and delivery
- [ ] Request correlation, API errors, CORS, and unavailable-service behavior
- [ ] Order and Inventory gateway routing when their service URLs are configured
- [ ] Frontend static/CDN deployment against the separately hosted backend API

Automated checks for the current changes include the frontend type-check,
backend tests, API Gateway tests, JavaScript syntax checks, and
`git diff --check`. The Inventory and Order Service suites were exercised in
the preceding service work. Independent local frontend, Gateway, and backend
processes were started, and the frontend, Gateway health/readiness, and a
proxied medicine API were exercised. The end-to-end workflow checklist above
remains acceptance work before the extracted services own all live workflows.
Create service-owned development data directly; no production migration,
dual-write process, or legacy synchronization is required.
