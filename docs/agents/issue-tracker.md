# Issue tracker: GitHub

GitHub Issues are the source of truth for bugs, requirements, investigations, and development tasks in `lazyq666/reroll-ai-canvas`.

The public Issues list is the contributor-facing source of truth. Maintainers may additionally visualize the workflow in a private planning board; public contributors do not need access to that board.

## Workflow

| Project status | Meaning |
| --- | --- |
| `Todo` | Accepted work that has not started |
| `In Progress` | Work is actively being implemented |
| `Review` | A pull request or completed implementation is awaiting review or verification |
| `Done` | The work is merged or verified and the Issue is closed |

GitHub Issue state and Project status are separate. Keep an Issue open in `Todo`, `In Progress`, or `Review`; close it when moving the work to `Done`.

## Rules

- Search open and closed Issues before creating a new one.
- Reuse or extend an existing Issue when it covers the same work.
- Maintainers who use the private planning board add every new tracked Issue there and set it to `Todo`.
- Move an Issue to `In Progress` when implementation begins.
- Move it to `Review` when the pull request or implementation is ready for review.
- Move it to `Done` and close it after merge and verification.
- Link pull requests with `Closes #<issue-number>` when merging should close the Issue.
- Preserve relevant acceptance criteria, diagnostics, priority, and source context in the Issue body.

Use the `gh` CLI for Issue and Project operations.

## Pull requests as a request surface

PRs as a request surface: no.

Pull requests implement or resolve Issues; they do not replace Issues as the primary place for recording requirements.
