import { expect, test } from '@playwright/test'
import { VIEWPORT, counter, dispatch, errorsOn, goTo, missionItem, missionList, openApp, rail } from './ui'

test.use({ viewport: VIEWPORT })

test('the third review waits in the queue, opens its details from there, and can be cancelled there', async ({ page }) => {
  await openApp(page)
  await dispatch(page, 412)
  await dispatch(page, 1203)
  await goTo(page, 'Floor')
  await expect(page.getByRole('region', { name: 'Queued' })).toHaveCount(0)

  // Both desks are held by findings waiting for triage, so the third PR stays queued.
  await dispatch(page, 58)
  await goTo(page, 'Floor')
  await expect(counter(page, 'queued')).toHaveText('1 queued')
  const shelf = page.getByRole('region', { name: 'Queued' })
  await expect(shelf.getByRole('listitem')).toHaveCount(1)
  const row = shelf.getByRole('button', { name: /^#58 / })
  await expect(row).toContainText('retry webhook deliveries')
  await expect(row).toContainText('Blind review')

  await row.click()
  await expect(rail(page).getByRole('button', { name: /^Triage/ })).toHaveAttribute('aria-current', 'page')
  await expect(missionItem(page, 58)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('[data-status]')).toContainText('Queued. It starts when a reviewer is free.')

  await goTo(page, 'Floor')
  const cancel = shelf.getByRole('button', { name: 'Cancel #58' })
  await cancel.click()
  await expect(cancel).toHaveText('Cancel?')
  await cancel.click()
  await expect(shelf).toHaveCount(0)
  await expect(counter(page, 'queued')).toHaveText('0 queued')

  await goTo(page, 'Triage')
  await expect(missionList(page).getByRole('region', { name: 'Failed' })).toContainText('#58')

  expect(errorsOn(page)).toEqual([])
})
