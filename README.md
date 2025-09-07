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