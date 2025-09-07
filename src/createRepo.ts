import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

export function getCreateRepoWebviewContent(webview: vscode.Webview, nonce: string, extensionUri: vscode.Uri): string {
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
                        <form class="github-create-repo-form">
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
                                    <p class="description">This is where you can write a long description for your project. <a href="#" onclick="return false;">Learn more about READMEs</a>.</p>
                                </div>
                            </div>
                            <button id="createRepoBtn" class="github-create-repo-btn">
                                <i class="codicon codicon-add"></i>
                                Create repository
                            </button>
                            <div id="error-message" class="error-message"></div>
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
                    });
                });
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'creationFailed') {
                        createRepoBtn.disabled = false;
                        createRepoBtn.innerHTML = '<i class="codicon codicon-add"></i>Create repository';
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
