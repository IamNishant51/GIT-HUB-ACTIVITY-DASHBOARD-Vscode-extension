import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

export function getCreateRepoWebviewContent(
    webview: vscode.Webview,
    nonce: string,
    extensionUri: vscode.Uri,
    gitignoreTemplates: string[] = [],
    licenseTemplates: { key: string; name: string; spdx_id?: string }[] = []
): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'createRepo.css'));
    const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <link href="${styleUri}" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>Create a New Repository</title>
        </head>
        <body>
            <div class="github-create-repo-bg">
                <div class="container">
                    <div class="github-create-repo">
                        <div class="header">
                            <i class="codicon codicon-repo"></i>
                            <h1>Create a new repository</h1>
                        </div>
                        <p class="github-create-repo-desc">A repository contains all project files, including the revision history. Already have a project repository elsewhere?</p>
                        <form class="github-create-repo-form" id="create-repo-form">
                            <div class="form-group">
                                <label for="repoName">Repository name <span class="required">*</span></label>
                                <div class="input-with-icon">
                                    <i class="codicon codicon-repo"></i>
                                    <input type="text" id="repoName" name="repoName" required placeholder="my-awesome-project">
                                </div>
                                <p class="description">Great repository names are short and memorable. Need inspiration? How about <strong>stellar-octo-guide</strong>?</p>
                            </div>
                            <div class="form-group">
                                <label for="description">Description <span class="description">(optional)</span></label>
                                <input type="text" id="description" name="description" placeholder="Short description of this repository">
                            </div>
                            <div class="form-group visibility-group">
                                <div class="radio-option">
                                    <input type="radio" id="public" name="visibility" value="public" checked>
                                    <label for="public">
                                        <i class="codicon codicon-globe"></i>
                                        <strong>Public</strong>
                                        <span class="description">Anyone on the internet can see this repository. You choose who can commit.</span>
                                    </label>
                                </div>
                                <div class="radio-option">
                                    <input type="radio" id="private" name="visibility" value="private">
                                    <label for="private">
                                        <i class="codicon codicon-lock"></i>
                                        <strong>Private</strong>
                                        <span class="description">You choose who can see and commit to this repository.</span>
                                    </label>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Initialize this repository with:</label>
                                <div class="checkbox-option">
                                    <input type="checkbox" id="addReadme" name="addReadme" checked>
                                    <label for="addReadme">Add a README file</label>
                                </div>
                                <div class="form-group" style="margin-top:12px;">
                                    <label for="gitignoreTemplate">.gitignore template</label>
                                    <select id="gitignoreTemplate" style="width:100%; padding:10px 12px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#f0f6fc;">
                                        <option value="">None</option>
                                        ${gitignoreTemplates.map(t => `<option value="${t}">${t}</option>`).join('')}
                                    </select>
                                    <p class="description">Select a language or framework specific .gitignore.</p>
                                </div>
                                <div class="form-group" style="margin-top:12px;">
                                    <label for="licenseTemplate">License</label>
                                    <select id="licenseTemplate" style="width:100%; padding:10px 12px; background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#f0f6fc;">
                                        <option value="">None</option>
                                        ${licenseTemplates.map(l => `<option value="${l.key}">${l.name}${l.spdx_id ? ' ('+l.spdx_id+')' : ''}</option>`).join('')}
                                    </select>
                                    <p class="description">Choose a license template appropriate for your project.</p>
                                </div>
                            </div>
                            <div class="form-group" style="margin-top:12px;">
                                <label for="defaultBranch">Default branch name</label>
                                <input type="text" id="defaultBranch" placeholder="main" value="main" />
                                <p class="description">Customize the initial branch name.</p>
                            </div>
                            <div class="form-group">
                                <label for="homepage">Homepage (optional)</label>
                                <input type="text" id="homepage" placeholder="https://example.com" />
                            </div>
                            <div class="form-group">
                                <label for="topics">Topics (comma separated)</label>
                                <input type="text" id="topics" placeholder="devtools, vscode, extension" />
                            </div>
                            <button id="createRepoBtn" class="github-create-repo-btn">
                                <i class="codicon codicon-add"></i>
                                Create repository
                            </button>
                            <div id="error-message" class="error-message"></div>
                            <div id="success-message" class="success-message" style="display:none;"></div>
                        </form>
                    </div>
                </div>
            </div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                const createRepoBtn = document.getElementById('createRepoBtn');
                const repoNameInput = document.getElementById('repoName');
                const descriptionInput = document.getElementById('description');
                const publicRadio = document.getElementById('public');
                const addReadmeCheckbox = document.getElementById('addReadme');
                const errorMessage = document.getElementById('error-message');
                const successMessage = document.getElementById('success-message');
                const gitignoreSelect = document.getElementById('gitignoreTemplate');
                const licenseSelect = document.getElementById('licenseTemplate');
                const defaultBranchInput = document.getElementById('defaultBranch');
                const homepageInput = document.getElementById('homepage');
                const topicsInput = document.getElementById('topics');
                
                createRepoBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const repoName = repoNameInput.value;
                    if (!repoName) {
                        errorMessage.textContent = 'Repository name is required.';
                        repoNameInput.focus();
                        return;
                    }
                    errorMessage.textContent = '';
                    createRepoBtn.disabled = true;
                    createRepoBtn.innerHTML = '<i class="codicon codicon-sync codicon-spin"></i> Creating repository...';
                    vscode.postMessage({
                        command: 'createRepository',
                        repoName: repoName,
                        description: descriptionInput.value,
                        isPrivate: !publicRadio.checked,
                        initReadme: addReadmeCheckbox.checked
                        gitignoreTemplate: gitignoreSelect.value || '',
                        licenseTemplate: licenseSelect.value || '',
                        defaultBranch: defaultBranchInput.value || 'main',
                        homepage: homepageInput.value || '',
                        topics: topicsInput.value.split(',').map(t => t.trim()).filter(Boolean)
                    });
                });
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'creationFailed') {
                        createRepoBtn.disabled = false;
                        createRepoBtn.innerHTML = '<i class="codicon codicon-add"></i>Create repository';
                    } else if (message.command === 'creationSuccess') {
                        createRepoBtn.disabled = true;
                        createRepoBtn.innerHTML = '<i class="codicon codicon-check"></i> Created';
                        successMessage.style.display = 'block';
                        successMessage.innerHTML = 'Repository <strong>' + message.repo.full_name + '</strong> created. <a href="#" id="openInPanel">Open now</a>';
                        const openLink = document.getElementById('openInPanel');
                        if (openLink) {
                            openLink.addEventListener('click', (e) => {
                                e.preventDefault();
                                vscode.postMessage({ command: 'openRepo', owner: message.repo.owner.login, repo: message.repo.name, repoUrl: message.repo.clone_url });
                            });
                        }
                    }
                });
            </script>
        </body>
        </html>
    `;
}

export function getRepoExplorerWebviewContent(webview: vscode.Webview, nonce: string, extensionUri: vscode.Uri, owner: string, repo: string, path: string = ""): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'createRepo.css'));

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <link href="${styleUri}" rel="stylesheet">
            <title>${repo} Explorer</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
                .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
                .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
                .header h1 { margin: 0; font-size: 24px; }
                .breadcrumb { display: flex; gap: 8px; margin-bottom: 20px; }
                .breadcrumb-item { color: var(--vscode-textLink-foreground); cursor: pointer; }
                .breadcrumb-item:hover { text-decoration: underline; }
                .breadcrumb-separator { color: var(--vscode-description-foreground); }
                .repo-list { list-style: none; padding: 0; }
                .repo-item { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin-bottom: 8px; background: var(--vscode-panel-background); cursor: pointer; transition: all 0.2s; }
                .repo-item:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-toolbar-hoverBackground); }
                .repo-item-icon { font-size: 16px; width: 20px; text-align: center; }
                .repo-item-name { flex: 1; font-weight: 500; }
                .repo-item-size { color: var(--vscode-description-foreground); font-size: 12px; }
                .loading { text-align: center; padding: 40px; color: var(--vscode-description-foreground); }
                .error { color: var(--vscode-errorForeground); padding: 20px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 6px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <span class="codicon codicon-repo"></span>
                    <h1>${owner}/${repo}</h1>
                </div>
                ${path ? `<div class="breadcrumb">${path.split('/').map((part, index) => {
                    const currentPath = path.split('/').slice(0, index + 1).join('/');
                    return `<span class="breadcrumb-item" data-path="${currentPath}">${part}</span>${index < path.split('/').length - 1 ? '<span class="breadcrumb-separator">/</span>' : ''}`;
                }).join('')}</div>` : ''}
                <div id="repo-explorer">
                    <div class="loading">Loading repository contents...</div>
                </div>
            </div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                
                // Handle breadcrumb navigation
                document.addEventListener('click', function(e) {
                    const breadcrumbItem = e.target.closest('.breadcrumb-item');
                    if (breadcrumbItem) {
                        const path = breadcrumbItem.getAttribute('data-path');
                        vscode.postMessage({ command: 'navigate', path: path });
                        e.preventDefault();
                    }
                });
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'updateExplorer') {
                        document.getElementById('repo-explorer').innerHTML = message.html;
                        
                        // Add click handlers for items
                        document.querySelectorAll('.repo-item[data-path]').forEach(item => {
                            item.addEventListener('click', function() {
                                const path = this.getAttribute('data-path');
                                const type = this.getAttribute('data-type');
                                if (type === 'dir') {
                                    vscode.postMessage({ command: 'navigate', path: path });
                                } else {
                                    vscode.postMessage({ command: 'openFile', path: path });
                                }
                            });
                        });
                    }
                });
            </script>
        </body>
        </html>
    `;
}
