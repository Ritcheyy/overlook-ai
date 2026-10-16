import { describe, expect, it } from 'vitest'
import { makeMission, makePr } from './review/test-helpers'
import { newPullRequestNotification, newPullRequestsSummary, notificationTarget, osNotificationActions, performNotificationAction, type NotificationApi } from './notifications'

describe('performNotificationAction', () => {
  it('runs the API call behind each button and says where to go afterwards', async () => {
    const calls: string[] = []
    const api: NotificationApi = {
      dispatch: async (args) => {
        calls.push(`dispatch ${args.prId}`)
        return makeMission({ id: 'm-new' })
      },
      rerunMission: async (id) => {
        calls.push(`rerun ${id}`)
      },
      retryMission: async (id) => {
        calls.push(`retry ${id}`)
      },
      ignorePullRequest: async (id) => {
        calls.push(`ignore ${id}`)
      }
    }
    const forPr = { title: 't', body: 'b', prId: 'acme/x#1' }
    const forMission = { title: 't', body: 'b', missionId: 'm-1' }
    expect(await performNotificationAction(api, forPr, 'review')).toEqual({ screen: 'triage', missionId: 'm-new', prId: 'acme/x#1' })
    expect(await performNotificationAction(api, forPr, 'ignore')).toBeUndefined()
    expect(await performNotificationAction(api, forMission, 'rerun')).toEqual({ screen: 'triage', missionId: 'm-1' })
    expect(await performNotificationAction(api, forMission, 'retry')).toEqual({ screen: 'triage', missionId: 'm-1' })
    expect(await performNotificationAction(api, forMission, 'open')).toEqual({ screen: 'triage', missionId: 'm-1' })
    expect(await performNotificationAction(api, forPr, 'open')).toEqual({ screen: 'triage', prId: 'acme/x#1' })
    expect(await performNotificationAction(api, forMission, 'review')).toBeUndefined()
    expect(await performNotificationAction(api, forPr, 'rerun')).toBeUndefined()
    expect(calls).toEqual(['dispatch acme/x#1', 'ignore acme/x#1', 'rerun m-1', 'retry m-1'])
  })

  it('sends a notification about nothing in particular to the Inbox', () => {
    expect(notificationTarget({})).toEqual({ screen: 'inbox' })
  })

  it('gives the OS notification its main action only', () => {
    const actions = [
      { id: 'review' as const, label: 'Review now' },
      { id: 'ignore' as const, label: 'Ignore' }
    ]
    expect(osNotificationActions({ actions })).toEqual([actions[0]])
    expect(osNotificationActions({})).toEqual([])
  })
})

describe('new PR notifications', () => {
  it('keep the body to the title, the author and the size', () => {
    const pr = makePr({ additions: 201, deletions: 145, changedFiles: 12 })
    expect(newPullRequestNotification(pr)).toEqual({
      title: 'New PR: checkout-api #412',
      body: `${pr.title}\n@dami-codes · +201 −145 · 12 files`,
      prId: pr.id,
      actions: [
        { id: 'review', label: 'Review now' },
        { id: 'ignore', label: 'Ignore' }
      ]
    })
    const unsized = makePr({ additions: undefined, deletions: undefined, changedFiles: undefined })
    expect(newPullRequestNotification(unsized).body).toBe(`${pr.title}\n@dami-codes`)
    expect(newPullRequestNotification(makePr({ additions: 1, deletions: 0, changedFiles: 1 })).body).toContain('+1 −0 · 1 file')
  })

  it('sum up a burst by repo', () => {
    const prs = [makePr(), makePr({ number: 2 }), makePr({ repo: { host: 'github', owner: 'acme', name: 'mobile-app', fullName: 'acme/mobile-app' }, number: 3 })]
    expect(newPullRequestsSummary(prs)).toEqual({ title: '3 new PRs in the Inbox', body: 'In checkout-api, mobile-app.' })
    expect(newPullRequestsSummary(prs.slice(0, 2)).body).toBe('All in checkout-api.')
  })
})
