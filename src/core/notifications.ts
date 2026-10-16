/**
 * What a notification offers and what its buttons do. Shared by the OS
 * notifier in main and the in-app toast, so both run the same action.
 */
import type { Notification, NotificationAction, NotificationActionId, PullRequest } from './domain'
import type { Api, NavigateArgs } from './ipc-contract'

export const OPEN: NotificationAction = { id: 'open', label: 'Open' }
export const RETRY: NotificationAction = { id: 'retry', label: 'Retry' }
export const rerun = (label: string): NotificationAction => ({ id: 'rerun', label })

/** More new PRs than this in one poll are announced together, as after a week away or a repo switched on. */
export const NEW_PR_BURST = 5

function size(pr: PullRequest): string {
  const parts: string[] = []
  if (pr.additions !== undefined || pr.deletions !== undefined) parts.push(`+${pr.additions ?? 0} −${pr.deletions ?? 0}`)
  if (pr.changedFiles !== undefined) parts.push(`${pr.changedFiles} ${pr.changedFiles === 1 ? 'file' : 'files'}`)
  return parts.join(' · ')
}

export function newPullRequestNotification(pr: PullRequest): Notification {
  const facts = [`@${pr.author}`, size(pr)].filter(Boolean).join(' · ')
  return {
    title: `New PR: ${pr.repo.name} #${pr.number}`,
    body: `${pr.title}\n${facts}`,
    prId: pr.id,
    actions: [
      { id: 'review', label: 'Review now' },
      { id: 'ignore', label: 'Ignore' }
    ]
  }
}

export function newPullRequestsSummary(prs: readonly PullRequest[]): Notification {
  const repos = [...new Set(prs.map((p) => p.repo.name))]
  return {
    title: `${prs.length} new PRs in the Inbox`,
    body: repos.length === 1 ? `All in ${repos[0]}.` : `In ${repos.slice(0, 3).join(', ')}${repos.length > 3 ? ' and more' : ''}.`
  }
}

/** Where clicking the notification itself goes. */
export function notificationTarget(n: Pick<Notification, 'missionId' | 'prId'>): NavigateArgs {
  if (n.missionId) return { screen: 'triage', missionId: n.missionId }
  if (n.prId) return { screen: 'triage', prId: n.prId }
  return { screen: 'inbox' }
}

export type NotificationApi = Pick<Api, 'dispatch' | 'rerunMission' | 'retryMission' | 'ignorePullRequest'>

/** Runs one of the notification's actions and says where to go afterwards, if anywhere. */
export async function performNotificationAction(api: NotificationApi, n: Notification, id: NotificationActionId): Promise<NavigateArgs | undefined> {
  switch (id) {
    case 'open':
      return notificationTarget(n)
    case 'review': {
      if (!n.prId) return undefined
      const mission = await api.dispatch({ prId: n.prId })
      // The PR id still opens the details while the snapshot with the new review is on its way.
      return { screen: 'triage', missionId: mission.id, prId: n.prId }
    }
    case 'ignore':
      if (n.prId) await api.ignorePullRequest(n.prId)
      return undefined
    case 'rerun':
      if (!n.missionId) return undefined
      await api.rerunMission(n.missionId)
      return { screen: 'triage', missionId: n.missionId }
    case 'retry':
      if (!n.missionId) return undefined
      await api.retryMission(n.missionId)
      return { screen: 'triage', missionId: n.missionId }
  }
}
