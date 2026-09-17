import { expect, test } from '@playwright/test'
import { VIEWPORT, counter, dispatch, errorsOn, goTo, hudCard, hudChip, openApp, screenshot } from './ui'

test.use({ viewport: VIEWPORT })

test('two characters review on the 3D floor and then wave for attention', async ({ page }) => {
  await openApp(page, 800)
  await dispatch(page, 412)
  await dispatch(page, 1203)

  await goTo(page, 'Floor')
  const floor = page.locator('[data-floor]')
  await expect(floor).toBeVisible()
  const mode = await floor.getAttribute('data-floor')
  if (mode === '3d') {
    await expect(floor.locator('canvas')).toBeVisible()
  } else {
    await expect(page.getByText('3D floor unavailable')).toBeVisible()
    test.info().annotations.push({ type: 'note', description: `WebGL unavailable in this browser; the DOM fallback rendered (data-floor=${mode})` })
  }

  await expect(hudCard(page, 'slot-1')).toContainText('Vhagar')
  await expect(hudCard(page, 'slot-2')).toContainText('Nova')
  await expect(hudCard(page, 'slot-1')).toContainText('#412')
  await expect(hudCard(page, 'slot-2')).toContainText('#1203')
  await expect(hudChip(page, 'slot-1')).toHaveText('Reviewing')
  await expect(hudChip(page, 'slot-2')).toHaveText('Reviewing')
  await screenshot(page, 'floor-reviewing')

  await expect(hudChip(page, 'slot-1')).toHaveText('Needs you', { timeout: 20_000 })
  await expect(hudChip(page, 'slot-2')).toHaveText('Needs you', { timeout: 20_000 })
  await expect(counter(page, 'needs you')).toHaveText('2 needs you')
  await expect(hudCard(page, 'slot-1').getByRole('button', { name: 'Open triage' })).toBeVisible()
  await screenshot(page, 'floor-needs-you')

  expect(errorsOn(page)).toEqual([])
})
