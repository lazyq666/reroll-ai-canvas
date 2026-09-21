# LAZ-12 interaction prototype

Status: awaiting design acceptance. No production implementation or deployment.

Source requirement: https://linear.app/lazyq/issue/LAZ-12

Branch: codex/laz-12-onboarding-demo

Run from this worktree:

    python3 -m http.server 8872 --bind 127.0.0.1

Open http://127.0.0.1:8872/static/onboarding-demo.html.

The standalone route uses the existing Reroll design tokens, fonts, branding,
provider artwork and i18n core. Native controls are prototype stand-ins for the
production ic-* components. No existing application route is replaced.

## Review paths

1. Enter a sample username and matching passwords (8+ characters).
2. Choose a simulated storage location.
3. Select APIMart and Dreamina CLI; nothing is preselected.
4. Enter a dummy key. Save, verification and discovery run in sequence.
5. The queue automatically opens Dreamina; simulate QR sign-in or defer it.
6. At least one connected source reveals Start creating on the Ready screen. Clicking it opens the existing local application canvas list at http://127.0.0.1:3001/static/canvas-list.html; no intermediate studio preview is shown.

The footer's Demo scenarios panel controls directory results (empty, existing,
nonempty, unavailable, unsupported), API success/failure, discovery failure for
Other API, and initial CLI installation/sign-in status. Selecting an option immediately opens its matching step and state. API Success
shows discovered models and Continue; API failure keeps input for retry. Existing
connected services are preserved. In-flight simulation callbacks are cancelled.
All-deferred queues show a recovery action and cannot finish setup.

Language and appearance controls are available in the header.

## Simulation boundaries

Accounts, folder inspection, folder selection, credentials, CLI discovery,
installation/login, connection tests and model results are all simulated.
The folder chooser is an in-page mock, not an OS dialog.
The QR graphic is explicitly nonfunctional. Model counts are sample data.
Only the APIMart key-management link opens an external service:
https://apimart.ai/keys (verified against the vendor's Get API Key link).

Account and service form state remains in memory and is cleared on reload.
The existing shared i18n core remembers the selected language on this preview origin.
No application API, real filesystem mutation, generated content or deployment
is involved. The Ready screen links to the existing local application; its own login requirements still apply.

## Verification

- JavaScript syntax check passed.
- Shared i18n validator passed: 3751 keys.
- Existing core creation and canvas management i18n regression tests: 15 passed.
- Browser: administrator → workspace → APIMart → automatic queue advance →
  Dreamina QR sign-in → ready, with Chinese/English switching and dark appearance.
- Browser: existing workspace opens via a distinct action.

The user has not accepted this prototype. Production behavior documentation,
issue completion status and release versions must not be promoted on this basis.
Before production work, confirm the default model enablement policy and map the
approved orchestration onto existing safe workspace inspection, account creation,
provider configuration and CLI interfaces.
- Browser: failed APIMart validation preserves the masked sample input; retrying
  with the Success scenario reaches Ready without re-entering the key.
- Browser: deferring every selected service blocks completion and offers recovery.
- Browser: narrow viewport keeps the five steps and service form operable.
