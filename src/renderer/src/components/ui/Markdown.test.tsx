// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Markdown, unwrapDetails } from './Markdown'

afterEach(cleanup)

describe('Markdown', () => {
  it('renders comment-builder details blocks without literal tags', () => {
    const md = 'Body\n\n<details>\n<summary>Suggestion</summary>\n\n```ts\nconst x = 1\n```\n\n</details>\n'
    const { container } = render(<Markdown>{md}</Markdown>)
    expect(container.textContent).not.toContain('<details>')
    expect(container.textContent).not.toContain('</details>')
    expect(screen.getByText('Suggestion').tagName).toBe('STRONG')
    expect(container.querySelector('pre code')?.textContent).toContain('const x = 1')
  })

  it('leaves ordinary markdown untouched', () => {
    const md = '# Title\n\n- one\n- two\n'
    expect(unwrapDetails(md)).toBe(md)
  })
})
