GitHub Activity Dashboard

A VS Code extension that shows your GitHub activity, repositories, history, stars, notifications, and a profile view inside the editor.

## Features
- Activity: Assigned issues and PRs requiring your review
- Repositories: Browse current repo contents
- History: Recent git commits in the workspace
- Stars: Explore your starred repositories
- Notifications: View GitHub notifications
- Profile: View your GitHub profile and open/clones repos

## Requirements
- VS Code 1.80+
- Git installed and available on PATH
- Sign in to GitHub when prompted

## Extension Settings
No custom settings. Uses VS Code GitHub authentication.

## Known Issues
- Webpack will warn about optional `supports-color` dependency from `debug`; it is safe to ignore for this extension.

## Release Notes
See CHANGELOG.md.

## Development
- Build once: `npm run compile`
- Watch: `npm run watch`
- Package for publishing: `npm run package`

After building, use "Run Extension" in VS Code to launch a development host.

## License
MIT
