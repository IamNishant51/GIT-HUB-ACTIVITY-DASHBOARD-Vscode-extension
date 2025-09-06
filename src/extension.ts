import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

class GitHubActivityProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private octokit: Octokit | undefined;

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
        this.octokit = new Octokit({ auth: session.accessToken });
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.octokit) {
            return [];
        }

        if (element) {
            // This is a leaf node
            return [];
        } else {
            // This is the root
            const username = await this.octokit.users.getAuthenticated().then(res => res.data.login);

            const [assignedIssues, reviewRequests] = await Promise.all([
                this.octokit.search.issuesAndPullRequests({ q: `is:open is:issue assignee:${username}` }),
                this.octokit.search.issuesAndPullRequests({ q: `is:open is:pr review-requested:${username}` })
            ]);

            const assignedIssuesItems = assignedIssues.data.items.map(issue => {
                const item = new vscode.TreeItem(issue.title, vscode.TreeItemCollapsibleState.None);
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Issue',
                    arguments: [vscode.Uri.parse(issue.html_url)]
                };
                item.tooltip = `#${issue.number}`;
                return item;
            });

            const reviewRequestsItems = reviewRequests.data.items.map(pr => {
                const item = new vscode.TreeItem(pr.title, vscode.TreeItemCollapsibleState.None);
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Pull Request',
                    arguments: [vscode.Uri.parse(pr.html_url)]
                };
                item.tooltip = `#${pr.number}`;
                return item;
            });

            return [
                new vscode.TreeItem(`Assigned Issues (${assignedIssuesItems.length})`, vscode.TreeItemCollapsibleState.Expanded),
                ...assignedIssuesItems,
                new vscode.TreeItem(`Review Requests (${reviewRequestsItems.length})`, vscode.TreeItemCollapsibleState.Expanded),
                ...reviewRequestsItems
            ];
        }
    }
}

class RepoTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly fileInfo: {
            owner?: string,
            repo?: string,
            path?: string,
            type: string,
            sha?: string
        }
    ) {
        super(label, collapsibleState);

        if (fileInfo.type === 'file') {
            this.command = {
                command: 'github-activity-dashboard.openFile',
                title: 'Open File',
                arguments: [this]
            };
            this.iconPath = new vscode.ThemeIcon('file');
        } else if (fileInfo.type === 'dir') {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

class GitHubRepoProvider implements vscode.TreeDataProvider<RepoTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RepoTreeItem | undefined | null | void> = new vscode.EventEmitter<RepoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RepoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private octokit: Octokit | undefined;

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            this.octokit = new Octokit({ auth: session.accessToken });
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('Could not authenticate with GitHub.');
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RepoTreeItem): vscode.TreeItem {
        return element;
    }

    private async getGitInfo(): Promise<{ owner: string; repo: string; branch: string; ahead: number; behind: number } | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }
        const cwd = workspaceFolder.uri.fsPath;

        try {
            const exec = (command: string) => new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
                require('child_process').exec(command, { cwd }, (err: Error, stdout: string, stderr: string) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve({ stdout, stderr });
                });
            });

            const remoteUrl = (await exec('git config --get remote.origin.url')).stdout.trim();
            const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?/);
            if (!match) return null;

            const [, owner, repo] = match;
            const branch = (await exec('git rev-parse --abbrev-ref HEAD')).stdout.trim();
            
            await exec('git fetch');
            const count = (await exec(`git rev-list --left-right --count origin/${branch}...HEAD`)).stdout.trim();
            const [behind, ahead] = count.split('\t').map(Number);

            return { owner, repo, branch, ahead, behind };

        } catch (error) {
            console.error('Error getting git info:', error);
            return null;
        }
    }

    async getChildren(element?: RepoTreeItem): Promise<RepoTreeItem[]> {
        if (!this.octokit) {
            return [];
        }

        if (element) {
            // It's a directory, fetch its content
            const { owner, repo, path } = element.fileInfo;
            if (typeof owner !== 'string' || typeof repo !== 'string' || typeof path !== 'string') {
                return []; // Cannot fetch content without repo info
            }
            const contents = await this.octokit.repos.getContent({ owner, repo, path });
            
            if (Array.isArray(contents.data)) {
                return contents.data.map(item => new RepoTreeItem(item.name, item.type === 'dir' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, { owner, repo, path: item.path, type: item.type, sha: item.sha }));
            }
            return [];

        } else {
            // It's the root, show the current repo
            const gitInfo = await this.getGitInfo();
            if (!gitInfo) {
                return [new RepoTreeItem('Not a git repository or no remote found.', vscode.TreeItemCollapsibleState.None, { type: 'message' })];
            }

            const { owner, repo, branch, ahead, behind } = gitInfo;
            
            let status = '';
            if (ahead > 0 && behind > 0) {
                status = `↑${ahead} ↓${behind}`;
            } else if (ahead > 0) {
                status = `↑${ahead}`;
            } else if (behind > 0) {
                status = `↓${behind}`;
            } else {
                status = '✓ Synced';
            }

            const repoItem = new RepoTreeItem(`${repo} (${branch})`, vscode.TreeItemCollapsibleState.Collapsed, { owner, repo, path: '', type: 'dir' });
            repoItem.description = status;
            repoItem.tooltip = `Current repository: ${owner}/${repo}`;
            repoItem.iconPath = new vscode.ThemeIcon('repo');

            return [repoItem];
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const githubActivityProvider = new GitHubActivityProvider();
    vscode.window.registerTreeDataProvider('github-activity-dashboard', githubActivityProvider);

    const githubRepoProvider = new GitHubRepoProvider();
    vscode.window.registerTreeDataProvider('github-repositories', githubRepoProvider);

    vscode.commands.registerCommand('github-activity-dashboard.refresh', () => {
        githubActivityProvider.refresh();
        githubRepoProvider.refresh();
    });

    vscode.commands.registerCommand('github-activity-dashboard.openFile', async (item: RepoTreeItem) => {
        if (!item.fileInfo.owner || !item.fileInfo.repo || !item.fileInfo.sha) return;
        
        const octokit = new Octokit({ 
            auth: (await vscode.authentication.getSession('github', ['repo'], { createIfNone: true })).accessToken 
        });

        const blob = await octokit.git.getBlob({
            owner: item.fileInfo.owner,
            repo: item.fileInfo.repo,
            file_sha: item.fileInfo.sha
        });

        const content = Buffer.from(blob.data.content, 'base64').toString('utf8');
        const doc = await vscode.workspace.openTextDocument({ content, language: item.label.split('.').pop() });
        await vscode.window.showTextDocument(doc, { preview: true });
    });
}

export function deactivate() {}
