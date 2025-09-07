# GitHub Activity Dashboard 🚀

<p align="center">
  <a href="https://code.visualstudio.com/">
    <img src="https://img.shields.io/badge/VS_Code-1.80%2B-blue.svg" alt="VS Code Version">
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
  </a>
  <a href="https://docs.github.com/en/rest">
    <img src="https://img.shields.io/badge/GitHub-API-green.svg" alt="GitHub API">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License">
  </a>
</p>

> **Bring your GitHub workflow directly into VS Code!**  
> Monitor activities, manage repositories, and stay updated with notifications—all without leaving your editor.

---

## ✨ Features

- **📊 Activity Tracking:**  
  View assigned issues & PRs, track PRs awaiting your review, monitor recent activities in real-time.

- **📂 Repository Management:**  
  Browse repository contents, quick access to files & folders, view branch information.

- **📜 Git History:**  
  Track recent commits in your workspace, monitor branch activities, view detailed commit info.

- **⭐ Stars Explorer:**  
  Browse your starred repositories, quick access to favorites, discover trending repos.

- **🔔 Notifications:**  
  Get real-time GitHub notifications, PR & Issue updates, and mention alerts.

- **👤 Profile Integration:**  
  View your GitHub profile, quick repository access, clone repositories directly.

---

## 🛠️ Requirements

- [VS Code](https://code.visualstudio.com/) **1.80+**
- [Git](https://git-scm.com/downloads) installed & available in PATH
- GitHub account authentication

---

## 📥 Installation

1. Open **VS Code**
2. Press <kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd>
3. Type `ext install github-activity-dashboard`
4. Click **Install**

---

## 🔐 Authentication

The extension uses VS Code's built-in GitHub authentication:

1. Click **Sign in to GitHub** when prompted
2. Complete the authentication process
3. Start using the extension!

---

## ⚙️ Development

Want to contribute? Awesome! Here’s how to set up your development environment:

```bash
# Clone the repository
git clone https://github.com/IamNishant51/github-activity-dashboard.git

# Install dependencies
npm install

# Build the extension
npm run compile

# Watch for changes
npm run watch

# Package for distribution/publishing
npm run package
```

---

## 🐛 Known Issues

- Webpack may display warnings about the optional `supports-color` dependency from `debug`—safe to ignore.
- Some GitHub Enterprise features may require extra configuration.
- Repository loading time can vary based on network connectivity.
- Large repositories may take longer to display full activity history.

---

## 📝 Release Notes

### **1.0.0** (2024-09-07)
- Initial release
- GitHub activity dashboard integration
- Repository browser implementation
- Notification system integration
- Profile view functionality
- Star management features

See [CHANGELOG.md](CHANGELOG.md) for full release history.

---

## 📄 License

MIT License © 2024 Nishant Unavane

```
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
```
---

 Made with ❤️ by [Nishant Unavane](https://github.com/IamNishant51)
