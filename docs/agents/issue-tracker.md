# Issue tracker: GitHub

GitHub Issues are the source of truth for bugs, requirements, investigations, and development tasks in `lazyq666/reroll-ai-canvas`.

The workflow is visualized in the [Reroll AI Canvas Development](https://github.com/users/lazyq666/projects/1) Project.

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
- Add every new tracked Issue to the Project and set it to `Todo`.
- Move an Issue to `In Progress` when implementation begins.
- Move it to `Review` when the pull request or implementation is ready for review.
- Move it to `Done` and close it after merge and verification.
- Link pull requests with `Closes #<issue-number>` when merging should close the Issue.
- Preserve relevant acceptance criteria, diagnostics, priority, and source context in the Issue body.

Use the `gh` CLI for Issue and Project operations.

## Pull requests as a request surface

PRs as a request surface: no.

Pull requests implement or resolve Issues; they do not replace Issues as the primary place for recording requirements.
