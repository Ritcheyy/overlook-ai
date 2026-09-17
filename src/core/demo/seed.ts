import type { PullRequest, RawFinding } from '../domain'
import { prIdOf, repoRefFromFullName } from '../domain'

export const DEMO_LOGIN = 'ritchey'

function pr(
  fullName: string,
  number: number,
  fields: Partial<PullRequest> & Pick<PullRequest, 'title' | 'author' | 'headRef' | 'headSha' | 'createdAt' | 'updatedAt'>
): PullRequest {
  return {
    id: prIdOf(fullName, number),
    repo: repoRefFromFullName(fullName),
    number,
    url: `https://github.com/${fullName}/pull/${number}`,
    baseRef: 'main',
    isDraft: false,
    state: 'open',
    labels: [],
    reviewRequested: fields.author !== DEMO_LOGIN,
    mine: fields.author === DEMO_LOGIN,
    ...fields
  }
}

/** Timestamps are relative to `now` so the inbox always looks fresh. */
export function seedPullRequests(now: Date): PullRequest[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString()
  return [
    pr('acme/checkout-api', 412, {
      title: 'fix(refunds): make refund creation idempotent per order',
      author: 'dami-codes',
      headRef: 'fix/refund-idempotency',
      headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      createdAt: ago(5),
      updatedAt: ago(1.5),
      additions: 212,
      deletions: 48,
      changedFiles: 7,
      labels: ['backend', 'payments'],
      body: 'Refunds could be created twice when the client retried. This adds an idempotency key derived from the order id and the refund amount.'
    }),
    pr('acme/storefront-web', 1203, {
      title: 'feat(cart): persist promo code across sessions',
      author: 'mariam-dev',
      headRef: 'feat/persist-promo',
      headSha: 'b2c3d4e5f60718293a4b5c6d7e8f90123456789a',
      createdAt: ago(28),
      updatedAt: ago(3),
      additions: 340,
      deletions: 61,
      changedFiles: 12,
      labels: ['frontend'],
      body: 'Stores the applied promo code in localStorage and re-applies it on load.'
    }),
    pr('acme/mobile-app', 77, {
      title: 'chore: bump react-native to 0.76 and fix hermes flags',
      author: 'kwame-builds',
      headRef: 'chore/rn-076',
      headSha: 'c3d4e5f60718293a4b5c6d7e8f90123456789ab1',
      createdAt: ago(50),
      updatedAt: ago(20),
      additions: 1180,
      deletions: 940,
      changedFiles: 41,
      labels: ['mobile', 'deps']
    }),
    pr('acme/notifications-service', 58, {
      title: 'feat: retry webhook deliveries with exponential backoff',
      author: 'dami-codes',
      headRef: 'feat/webhook-retries',
      headSha: 'd4e5f60718293a4b5c6d7e8f90123456789ab1c2',
      createdAt: ago(9),
      updatedAt: ago(0.5),
      additions: 156,
      deletions: 22,
      changedFiles: 5,
      labels: ['backend']
    }),
    pr('acme/checkout-api', 419, {
      title: 'feat(auth): return sessionExpiresIn and set refresh cookie on /',
      author: DEMO_LOGIN,
      headRef: 'feat/session-expiry',
      headSha: 'e5f60718293a4b5c6d7e8f90123456789ab1c2d3',
      createdAt: ago(2),
      updatedAt: ago(0.2),
      additions: 88,
      deletions: 14,
      changedFiles: 4,
      labels: ['backend', 'auth']
    }),
    pr('acme/storefront-web', 1210, {
      title: 'feat(floor-plan): seat picker with live availability',
      author: DEMO_LOGIN,
      headRef: 'feat/seat-picker',
      headSha: 'f60718293a4b5c6d7e8f90123456789ab1c2d3e4',
      createdAt: ago(72),
      updatedAt: ago(6),
      additions: 2210,
      deletions: 130,
      changedFiles: 33,
      labels: ['frontend', 'epic'],
      isDraft: true
    })
  ]
}

export interface DemoReviewScript {
  summary: string
  /** Markdown shown to the reviewer in triage; never posted. */
  briefing: string
  verdict: 'approve' | 'request_changes' | 'comment'
  findings: RawFinding[]
  /** Activity lines emitted while "reviewing", in order. */
  activity: { kind: 'reading' | 'thinking' | 'searching' | 'writing' | 'running'; text: string }[]
}

const GENERIC_ACTIVITY: DemoReviewScript['activity'] = [
  { kind: 'reading', text: 'Reading the diff' },
  { kind: 'searching', text: 'Finding call sites of changed functions' },
  { kind: 'reading', text: 'Opening surrounding modules' },
  { kind: 'thinking', text: 'Tracing the failure path' },
  { kind: 'running', text: 'git log --oneline -20' },
  { kind: 'reading', text: 'Checking the tests that cover this' },
  { kind: 'writing', text: 'Writing findings' }
]

export const DEMO_REVIEWS: Record<string, DemoReviewScript> = {
  'acme/checkout-api#412': {
    verdict: 'request_changes',
    summary:
      'The idempotency key is derived from order id and amount, so two legitimate partial refunds of the same amount collide. Otherwise the change is solid and well tested.',
    briefing: [
      '- Stops duplicate refunds when a client retries `POST /refunds`: the second call now returns the first refund instead of creating another.',
      '- Adds an `idempotency_key` column to `refunds` (migration `0042`, unique per order) and a lookup before insert in `RefundService.createRefund`.',
      '- The key is derived server-side from order id and amount; the author chose this over requiring an `Idempotency-Key` header so existing mobile clients keep working without a release.',
      '- Keys never expire. Stripe-side idempotency is untouched.',
      '- Migration must run before deploy; it backfills existing rows in one statement, which the author says is fine at current table size.'
    ].join('\n'),
    activity: GENERIC_ACTIVITY,
    findings: [
      {
        severity: 'blocker',
        category: 'correctness',
        title: 'Two partial refunds of equal amount share one idempotency key',
        body: 'The key is `sha256(orderId + amount)`. A customer refunded twice for the same amount on the same order will have the second refund silently return the first one. `createRefund` never checks whether the matched refund is already settled.',
        file: 'src/refunds/refund.service.ts',
        line: 48,
        suggestion: '```ts\nconst key = input.idempotencyKey ?? sha256(`${orderId}:${amount}:${input.reason}:${lineItemIds.join(",")}`)\n```\nBetter: require the client to send `Idempotency-Key` and only fall back to a derived key for legacy callers.'
      },
      {
        severity: 'major',
        category: 'testing',
        title: 'No test covers the retry path with a different amount',
        body: 'The new spec only asserts that an identical request is deduplicated. Add a case where the second request differs in amount and assert a second refund is created.',
        file: 'src/refunds/refund.service.spec.ts',
        line: 112
      },
      {
        severity: 'minor',
        category: 'product',
        title: 'Should a refund retry after 24h still be deduplicated?',
        body: 'The key has no TTL. Stripe expires idempotency keys after 24 hours. This is a product decision: if support re-issues a refund a week later with the same amount, do we want it blocked?',
        file: 'src/refunds/refund.service.ts',
        line: 61
      },
      {
        severity: 'nit',
        category: 'style',
        title: 'Unused import `RefundStatus`',
        body: 'Left over from the previous approach.',
        file: 'src/refunds/refund.controller.ts',
        line: 3
      }
    ]
  },
  'acme/storefront-web#1203': {
    verdict: 'comment',
    summary:
      'Works as described. One real bug around expired promo codes being re-applied, and a question about whether the code should survive logout.',
    briefing: [
      '- Keeps a promo code applied across visits: the code is written to `localStorage` under `cart.promo` and re-applied when the cart loads.',
      '- New `usePromoCode` hook replaces the inline state in `CartPanel`; `PromoInput` now reads from it.',
      '- Storage failures (private mode, quota) are swallowed so the cart still works without persistence.',
      '- No server changes and no validation call on load; the author kept it client-only to ship before the weekend sale.',
      '- Behind no flag. A follow-up to clear the code on logout is mentioned but not included.'
    ].join('\n'),
    activity: GENERIC_ACTIVITY,
    findings: [
      {
        severity: 'major',
        category: 'correctness',
        title: 'Expired promo codes are re-applied without validation',
        body: 'On load the stored code is pushed straight into cart state. If it expired overnight the cart shows a discount the server will reject at checkout.',
        file: 'src/cart/usePromoCode.ts',
        line: 27,
        suggestion: 'Validate the stored code with `POST /promo/validate` before applying, and clear storage on rejection.'
      },
      {
        severity: 'minor',
        category: 'product',
        title: 'Should a promo code survive logout?',
        body: 'The code is stored per browser, not per user. A shared device will carry one customer’s code into the next customer’s session.',
        file: 'src/cart/usePromoCode.ts',
        line: 14
      },
      {
        severity: 'major',
        category: 'integration',
        title: 'Promo re-apply assumes sessionExpiresIn is seconds',
        body: 'checkout-api#419 changes the field to seconds; this PR still treats it as milliseconds when scheduling the promo refresh.',
        file: 'src/cart/usePromoCode.ts',
        line: 41,
        relatedPr: 'acme/checkout-api#419'
      },
      {
        severity: 'praise',
        category: 'testing',
        title: 'Nice coverage of the storage failure path',
        body: 'The private-mode test that makes localStorage throw is exactly the case that bites in Safari.'
      }
    ]
  },
  'acme/mobile-app#77': {
    verdict: 'comment',
    summary: 'Mechanical upgrade. Two flags look copy-pasted from the wrong platform.',
    briefing: [
      '- Bumps `react-native` 0.74 to 0.76 and the matching `@react-native/*` tooling, Metro and Hermes.',
      '- Regenerates `ios/Podfile.lock` and `android/gradle.properties`; enables the new architecture on both platforms.',
      '- Removes the `react-native-screens` patch that 0.76 made unnecessary.',
      '- Most of the 41 files are lockfile and template churn; app code changes are limited to two deprecated `StyleSheet` calls.',
      '- Needs a clean `pod install` and a Gradle cache wipe on CI runners; the author asks for a full device smoke test before release.'
    ].join('\n'),
    activity: GENERIC_ACTIVITY,
    findings: [
      {
        severity: 'major',
        category: 'correctness',
        title: 'Hermes is disabled for iOS release builds',
        body: '`hermes_enabled` is set under `:ios` only in the debug config block. Release builds fall back to JSC, which changes performance and crash behaviour.',
        file: 'ios/Podfile',
        line: 41
      },
      {
        severity: 'minor',
        category: 'maintainability',
        title: 'Duplicate `newArchEnabled` key in gradle.properties',
        body: 'The last one wins, so the file works by accident.',
        file: 'android/gradle.properties',
        line: 22
      }
    ]
  },
  'acme/notifications-service#58': {
    verdict: 'request_changes',
    summary: 'Backoff maths is right, but retries are not persisted, so a restart drops every in-flight delivery.',
    briefing: [
      '- Retries failed webhook deliveries instead of dropping them after one attempt.',
      '- New `RetryQueue` schedules up to 6 attempts with exponential backoff (1s to 32s, jittered) and marks the delivery `dead` afterwards.',
      '- Adds `WEBHOOK_MAX_ATTEMPTS` and `WEBHOOK_BACKOFF_BASE_MS` config, both with defaults, and a `webhook_retries_total` metric.',
      '- The queue is in-process by design: the author wanted to avoid a Redis dependency for the first iteration and notes persistence as a follow-up.',
      '- No schema changes. Partners will see delayed rather than missing deliveries once this ships.'
    ].join('\n'),
    activity: GENERIC_ACTIVITY,
    findings: [
      {
        severity: 'blocker',
        category: 'correctness',
        title: 'Retry state lives only in memory',
        body: 'The retry queue is a `Map` on the service instance. A deploy during a partner outage loses every pending webhook.',
        file: 'src/webhooks/retry-queue.ts',
        line: 18,
        suggestion: 'Persist attempts to the `webhook_deliveries` table and reload them on boot, or move scheduling to the existing BullMQ queue.'
      },
      {
        severity: 'minor',
        category: 'security',
        title: 'Partner response bodies are logged in full',
        body: 'Some partners echo the payload, which can include customer email addresses.',
        file: 'src/webhooks/deliver.ts',
        line: 66
      }
    ]
  },
  'acme/checkout-api#419': {
    verdict: 'approve',
    summary: 'Small, correct, and covered. One nit.',
    briefing: [
      '- Lets clients know when a session ends: `POST /auth/login` and `/auth/refresh` now return `sessionExpiresIn` alongside the token.',
      '- Sets the refresh cookie on path `/` instead of `/auth` so the SPA can refresh from any route.',
      '- No new dependencies or config; the expiry comes from the existing `SESSION_TTL` setting.',
      '- Cookie `SameSite` and `Secure` flags are unchanged.',
      '- The web client change that reads the new field lands separately.'
    ].join('\n'),
    activity: GENERIC_ACTIVITY,
    findings: [
      {
        severity: 'nit',
        category: 'style',
        title: '`sessionExpiresIn` is seconds but the field name does not say so',
        body: 'Consider `sessionExpiresInSec` or document the unit in the OpenAPI schema.',
        file: 'src/auth/auth.controller.ts',
        line: 91
      }
    ]
  },
  'acme/storefront-web#1210': {
    verdict: 'request_changes',
    summary: 'Big feature, mostly clean. One race in the hold flow and one accessibility gap.',
    briefing: [
      '- Adds an interactive seat picker to the event page: an SVG floor plan with live availability and a 5-minute hold on a chosen seat.',
      '- New `SeatMap`, `SeatLegend` and `useSeatHold`; availability is polled from `GET /events/:id/seats` every 5s and holds go through `POST /seats/:id/hold`.',
      '- Behind the `seat_picker` feature flag, off by default; the old section-based picker stays as the fallback.',
      '- Polling was chosen over the existing WebSocket channel to keep the first cut simple; the author plans to switch once the flag is on for everyone.',
      '- Still a draft: mobile layout and keyboard support are listed as follow-ups.'
    ].join('\n'),
    activity: GENERIC_ACTIVITY,
    findings: [
      {
        severity: 'major',
        category: 'correctness',
        title: 'Seat hold can be granted to two tabs at once',
        body: 'The availability check and the hold request are two calls. Two tabs clicking the same seat within the poll window both see it free.',
        file: 'src/floor-plan/useSeatHold.ts',
        line: 54,
        suggestion: 'Let the server reject the second hold and surface that error instead of pre-checking on the client.'
      },
      {
        severity: 'minor',
        category: 'product',
        title: 'Seats are not reachable by keyboard',
        body: 'The SVG seats have click handlers but no `tabIndex` or `role="button"`.',
        file: 'src/floor-plan/SeatMap.tsx',
        line: 120
      }
    ]
  }
}

export function demoReviewFor(prId: string): DemoReviewScript {
  return (
    DEMO_REVIEWS[prId] ?? {
      verdict: 'comment',
      summary: 'No notable problems found.',
      briefing: '- A small, self-contained change with no new endpoints, schema changes, flags or dependencies.\n- Nothing to know before merging.',
      activity: GENERIC_ACTIVITY,
      findings: [
        {
          severity: 'nit',
          category: 'style',
          title: 'Consider a changelog entry',
          body: 'The change is user-visible but the changelog was not updated.'
        }
      ]
    }
  )
}
