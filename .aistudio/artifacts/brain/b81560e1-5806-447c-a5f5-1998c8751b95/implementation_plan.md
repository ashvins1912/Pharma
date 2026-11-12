# Implementation Plan - Optimized Fulfillment Screen & OTP Delivery Flow

## User Requirements
1. Manage local state of each order card in fulfillment (`AdminFulfillmentKanban.jsx`), tracking `isClosable`, OTP verification inputs, and revealed states.
2. Add "Mark as Delivered" button that reveals the 4-digit verification code input.
3. Implement robust OTP validation logic on delivery cards.
4. Make fulfillment cards closable with required details on the header (Order ID, customer name, total amount, close action button).
5. Optimize fulfillment screen with a **Tabbed column view featuring a horizontal/vertical toggle** to eliminate confusing vertical scrolling.

## Proposed Changes

### 1. `AdminFulfillmentKanban.jsx`
- **State Management**:
  - Add per-card local state dictionary or card state trackers (`cardStates = { [orderId]: { otpInput: '', otpRevealed: false, isClosed: false } }`).
  - Maintain `layoutMode` state (`'tabbed'` vs `'columns'`, with horizontal scroll / grid toggle).
- **Out for Delivery ("Dispatched") Card Enhancements**:
  - Add header with Order ID, customer name, total amount, and close button (removes card from view or marks as closed).
  - Add "Mark as Delivered" button. Clicking it reveals the 4-digit verification code input.
  - Add "Validate OTP & Complete" action that checks the 4-digit code (or accepts 4-digit entry), triggers API mark as delivered, and automatically closes the card with success notification.
  - Add "Resend OTP" action button with toast feedback.
- **UX Optimization (Solving Confusing Vertical Scroll)**:
  - Add a top toolbar with:
    - View Mode Toggle: **Tabbed Column View** (select active stage tab: Pending Review, Approved, Ready to Dispatch, Out for Delivery, Delivered, Cancelled) vs **All Columns Grid**.
    - Horizontal / Vertical Kanban toggle for columns.
    - Quick search and filter bar.

## Verification Plan
- **Automated Build & Lint**:
  - Run `compile_applet` and `lint_applet` to ensure zero compilation or type errors.
- **Interactive Verification**:
  - Test opening Out for Delivery cards, clicking "Mark as Delivered", entering 4-digit OTP, validating, and closing cards.
  - Verify tabbed view and layout toggles.
