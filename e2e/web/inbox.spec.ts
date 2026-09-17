import { expect, test } from '@playwright/test'
import { VIEWPORT, errorsOn, goTo, inboxRow, openApp, screenshot } from './ui'

test.use({ viewport: VIEWPORT })

const SEED: { repo: string; numbers: number[] }[] = [
  { repo: 'acme/checkout-api', numbers: [412, 419] },
  { repo: 'acme/mobile-app', numbers: [77] },
  { repo: 'acme/notifications-service', numbers: [58] },
  { repo: 'acme/storefront-web', numbers: [1203, 1210] }
]

test('lists the seed inbox grouped by repo, filters to mine, and narrows by search', async ({ page }) => {
  await openApp(page)
  await expect(page.getByText('Overlook', { exact: true })).toBeVisible()

  await goTo(page, 'Inbox')
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  await expect(page.getByText('6 pull requests', { exact: true })).toBeVisible()

  const groups = page.locator('section[aria-label^="acme/"] h2')
  await expect(groups).toHaveText(SEED.map((g) => new RegExp(`^${g.repo}\\s*${g.numbers.length}$`)))
  for (const { repo, numbers } of SEED) {
    const region = page.getByRole('region', { name: repo })
    await expect(region.getByRole('listitem')).toHaveCount(numbers.length)
    for (const n of numbers) await expect(region.getByText(`#${n}`, { exact: true })).toBeVisible()
  }
  await expect(inboxRow(page, 1210)).toContainText('DRAFT')
  await expect(inboxRow(page, 419)).toContainText('mine')
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(6)
  await screenshot(page, 'inbox')

  const filter = page.getByRole('group', { name: 'Filter pull requests' })
  await filter.getByRole('button', { name: /^Mine/ }).click()
  await expect(page.getByText('2 pull requests', { exact: true })).toBeVisible()
  await expect(inboxRow(page, 419)).toBeVisible()
  await expect(inboxRow(page, 1210)).toBeVisible()
  await expect(inboxRow(page, 412)).toHaveCount(0)

  await filter.getByRole('button', { name: /^Requested/ }).click()
  await expect(page.getByText('4 pull requests', { exact: true })).toBeVisible()

  await filter.getByRole('button', { name: /^All/ }).click()
  const search = page.getByRole('textbox', { name: 'Search pull requests' })
  await search.fill('refund')
  await expect(page.getByText('1 pull request', { exact: true })).toBeVisible()
  await expect(inboxRow(page, 412)).toBeVisible()
  await expect(page.locator('section[aria-label^="acme/"]')).toHaveCount(1)

  await search.fill('mariam-dev')
  await expect(inboxRow(page, 1203)).toBeVisible()
  await expect(page.getByText('1 pull request', { exact: true })).toBeVisible()

  await search.fill('nothing matches this')
  await expect(page.getByText('No matches')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('6 pull requests', { exact: true })).toBeVisible()
  await expect(search).toHaveValue('')

  expect(errorsOn(page)).toEqual([])
})
