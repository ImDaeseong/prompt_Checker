# Release Checklist

## Local Validation

- Load `extension/` from `chrome://extensions`.
- Refresh an open ChatGPT tab and run one test.
- Refresh an open Gemini tab and run one test.
- Confirm the result box shows only the new response, not an old answer.
- Confirm the Update button copies the improved prompt into the prompt field.
- Confirm no secrets, company information, customer information, API keys, tokens, or passwords are included.

## Chrome Web Store Package

Upload this zip file:

```text
release/prompt-checker-extension-v1.0.0.zip
```

The zip should contain `manifest.json` at the root of the archive.

## GitHub

Recommended repository name:

```text
prompt-checker
```

Recommended visibility:

```text
Public only after local Chrome/Gemini/ChatGPT tests pass.
Private while still testing.
```

