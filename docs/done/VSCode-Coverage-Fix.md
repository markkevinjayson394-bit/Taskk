# Fix VS Code CSS Linter Warnings on Coverage Files

## Implementation Steps

- [x] Step 1: Edit .vscode/settings.json to add `files.exclude` for `**/coverage/**`
- [x] Step 2: Edit .gitignore to add `coverage/`
- [x] Step 3: Reload VS Code window and verify (run `jest --coverage` to test)

## Followup

Reload VS Code: Ctrl/Cmd+Shift+P → \"Developer: Reload Window\"
Run `git status` to check coverage/ ignored.
