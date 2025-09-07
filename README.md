# GitHub Activity Dashboard 🚀

[![VS Code](https://img.shields.io/badge/VS_Code-1.80+-blue.svg)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub API](https://img.shields.io/badge/GitHub-API-green.svg)](https://docs.github.com/en/rest)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Bring your GitHub workflow directly into VS Code! Monitor activities, manage repositories, and stay updated with notifications - all without leaving your editor.

<p align="center">
  <img src="images/preview.gif" alt="GitHub Activity Dashboard Preview" width="600px">
</p>

## ✨ Features

### 📊 Activity Tracking
- View assigned issues and pull requests
- Track PRs awaiting your review
- Monitor recent activities in real-time

### 📂 Repository Management
- Browse current repository contents
- Quick access to files and folders
- View branch information

### 📜 Git History
- Track recent commits in your workspace
- Monitor branch activities
- View detailed commit information

### ⭐ Stars Explorer
- Browse your starred repositories
- Quick access to favorite projects
- Discover trending repositories

### 🔔 Notifications
- Real-time GitHub notifications
- PR and Issue updates
- Mention alerts

### 👤 Profile Integration
- View your GitHub profile
- Quick repository access
- Clone repositories directly

## 🛠️ Requirements

- VS Code 1.80+
- Git installed and available in PATH
- GitHub account authentication

## 📥 Installation

1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P`
3. Type `ext install github-activity-dashboard`
4. Click Install

## 🔐 Authentication

The extension uses VS Code's built-in GitHub authentication:
1. Click "Sign in to GitHub" when prompted
2. Complete the authentication process
3. Start using the extension

## ⚙️ Development

Want to contribute? Great! Here's how to set up the development environment:

```bash
# Clone the repository
git clone https://github.com/IamNishant51/github-activity-dashboard.git

# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes
npm run watch

# Package for distribution
npm run package

## Known Issues 🐛

- Webpack may display warnings about the optional `supports-color` dependency from `debug`. This is safe to ignore and doesn't affect functionality.
- Some GitHub Enterprise features might require additional configuration.
- Repository loading time may vary based on network connectivity.
- Large repositories might take longer to display full activity history.

## Release Notes 📝

### Version 1.0.0 (2024-09-07)
- Initial release
- GitHub activity dashboard integration
- Repository browser implementation
- Notification system integration
- Profile view functionality
- Star management features

For full release history, see [CHANGELOG.md](CHANGELOG.md)

## Development 💻

```bash
# Clone the repository
git clone https://github.com/IamNishant51/github-activity-dashboard.git

# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes
npm run watch

# Package for publishing
npm run package

#Licence 📄

MIT License

Copyright (c) 2024 Nishant Unavane

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.