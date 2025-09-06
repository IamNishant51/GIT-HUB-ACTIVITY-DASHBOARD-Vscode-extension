import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import simpleGit from 'simple-git';

class GitHubActivityProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private octokit: Octokit | undefined;

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            this.octokit = new Octokit({ auth: session.accessToken });
            // Don't auto-refresh here to avoid race conditions
        } catch (error) {
            console.error('Failed to initialize GitHub authentication:', error);
        }
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
            return [];
        } else {
            try {
                const username = await this.octokit.users.getAuthenticated().then(res => res.data.login);

                // Fetch data in parallel with limits for faster loading
                const [assignedIssues, reviewRequests] = await Promise.all([
                    this.octokit.search.issuesAndPullRequests({ 
                        q: `is:open is:issue assignee:${username}`,
                        per_page: 10, // Reduced for faster loading
                        sort: 'updated'
                    }),
                    this.octokit.search.issuesAndPullRequests({ 
                        q: `is:open is:pr review-requested:${username}`,
                        per_page: 10, // Reduced for faster loading  
                        sort: 'updated'
                    })
                ]);

                const assignedIssuesItems = assignedIssues.data.items.map(issue => {
                    const item = new vscode.TreeItem(`🐛 ${issue.title}`, vscode.TreeItemCollapsibleState.None);
                    item.command = {
                        command: 'vscode.open',
                        title: 'Open Issue',
                        arguments: [vscode.Uri.parse(issue.html_url)]
                    };
                    item.tooltip = `#${issue.number} - ${issue.repository_url.split('/').slice(-1)[0]}`;
                    return item;
                });

                const reviewRequestsItems = reviewRequests.data.items.map(pr => {
                    const item = new vscode.TreeItem(`🔍 ${pr.title}`, vscode.TreeItemCollapsibleState.None);
                    item.command = {
                        command: 'vscode.open',
                        title: 'Open Pull Request',
                        arguments: [vscode.Uri.parse(pr.html_url)]
                    };
                    item.tooltip = `#${pr.number} - ${pr.repository_url.split('/').slice(-1)[0]}`;
                    return item;
                });

                return [
                    new vscode.TreeItem(`📋 Assigned Issues (${assignedIssuesItems.length})`, vscode.TreeItemCollapsibleState.Expanded),
                    ...assignedIssuesItems,
                    new vscode.TreeItem(`👀 Review Requests (${reviewRequestsItems.length})`, vscode.TreeItemCollapsibleState.Expanded),
                    ...reviewRequestsItems
                ];
            } catch (error) {
                return [new vscode.TreeItem('❌ Error loading GitHub data', vscode.TreeItemCollapsibleState.None)];
            }
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
        } catch (error) {
            console.error('Could not authenticate with GitHub:', error);
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

class GitHubHistoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [new vscode.TreeItem('No workspace folder open.', vscode.TreeItemCollapsibleState.None)];
        }

        try {
            const git = simpleGit(workspaceFolder.uri.fsPath);
            if (!await git.checkIsRepo()) {
                return [new vscode.TreeItem('Not a git repository.', vscode.TreeItemCollapsibleState.None)];
            }

            const log = await git.log({ maxCount: 20 });

            if (log.all.length === 0) {
                return [new vscode.TreeItem('No commits found.', vscode.TreeItemCollapsibleState.None)];
            }

            return log.all.map(commit => {
                const commitItem = new vscode.TreeItem(
                    commit.message,
                    vscode.TreeItemCollapsibleState.None
                );
                commitItem.description = `${commit.author_name} - ${new Date(commit.date).toLocaleDateString()}`;
                commitItem.tooltip = `${commit.hash}\n${commit.author_name} - ${commit.date}\n\n${commit.message}`;
                commitItem.command = {
                    command: 'github-activity-dashboard.checkoutCommit',
                    title: 'Checkout Commit',
                    arguments: [commit.hash]
                };
                commitItem.iconPath = new vscode.ThemeIcon('git-commit');
                return commitItem;
            });

        } catch (err: any) {
            console.error("Failed to get git history:", err);
            return [new vscode.TreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
        }
    }
}

class StarredRepoTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly repoInfo?: {
            owner: string,
            repo: string,
            path?: string,
            type: string,
            sha?: string,
            url?: string
        }
    ) {
        super(label, collapsibleState);

        if (repoInfo?.type === 'file') {
            this.command = {
                command: 'github-activity-dashboard.openStarredFile',
                title: 'Open File',
                arguments: [this]
            };
            this.iconPath = new vscode.ThemeIcon('file');
        } else if (repoInfo?.type === 'dir') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (repoInfo?.type === 'repo') {
            this.iconPath = new vscode.ThemeIcon('repo');
            this.contextValue = 'starredRepo';
        }
    }
}

class GitHubStarsProvider implements vscode.TreeDataProvider<StarredRepoTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<StarredRepoTreeItem | undefined | null | void> = new vscode.EventEmitter<StarredRepoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<StarredRepoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private octokit: Octokit | undefined;

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            this.octokit = new Octokit({ auth: session.accessToken });
        } catch (error) {
            console.error('Could not authenticate with GitHub:', error);
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: StarredRepoTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: StarredRepoTreeItem): Promise<StarredRepoTreeItem[]> {
        if (!this.octokit) {
            return [];
        }

        if (element && element.repoInfo) {
            // It's a repository or directory, fetch its content
            const { owner, repo, path } = element.repoInfo;
            if (element.repoInfo.type === 'repo' || element.repoInfo.type === 'dir') {
                try {
                    const contents = await this.octokit.repos.getContent({ 
                        owner, 
                        repo, 
                        path: path || '' 
                    });
                    
                    if (Array.isArray(contents.data)) {
                        return contents.data.map(item => 
                            new StarredRepoTreeItem(
                                item.name, 
                                item.type === 'dir' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, 
                                { 
                                    owner, 
                                    repo, 
                                    path: item.path, 
                                    type: item.type, 
                                    sha: item.sha 
                                }
                            )
                        );
                    }
                } catch (err: any) {
                    return [new StarredRepoTreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
                }
            }
            return [];
        } else {
            // It's the root, show starred repositories
            try {
                const starred = await this.octokit.activity.listReposStarredByAuthenticatedUser();
                
                return starred.data.map(repo => {
                    const item = new StarredRepoTreeItem(
                        repo.name, 
                        vscode.TreeItemCollapsibleState.Collapsed,
                        {
                            owner: repo.owner.login,
                            repo: repo.name,
                            type: 'repo',
                            url: repo.html_url
                        }
                    );
                    item.description = `⭐ ${repo.stargazers_count}`;
                    item.tooltip = `${repo.full_name}\n⭐ ${repo.stargazers_count} stars\n🍴 ${repo.forks_count} forks\n\n${repo.description || 'No description'}`;
                    return item;
                });
            } catch (err: any) {
                return [new StarredRepoTreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
            }
        }
    }
}

class GitHubProfileProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

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

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.octokit) {
            return [new vscode.TreeItem('Please authenticate with GitHub', vscode.TreeItemCollapsibleState.None)];
        }

        try {
            const user = await this.octokit.users.getAuthenticated();
            const userData = user.data;

            const profileItems = [
                new vscode.TreeItem(`👤 ${userData.name || userData.login}`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`📧 ${userData.email || 'Private'}`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`🏢 ${userData.company || 'No company'}`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`📍 ${userData.location || 'No location'}`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`📝 ${userData.bio || 'No bio'}`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`📊 ${userData.public_repos} public repos`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`👥 ${userData.followers} followers`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`👤 ${userData.following} following`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`⭐ ${userData.public_gists} public gists`, vscode.TreeItemCollapsibleState.None),
                new vscode.TreeItem(`📅 Joined ${new Date(userData.created_at).toLocaleDateString()}`, vscode.TreeItemCollapsibleState.None)
            ];

            // Add command to open profile
            const openProfileItem = new vscode.TreeItem('🔗 View Profile in VS Code', vscode.TreeItemCollapsibleState.None);
            openProfileItem.command = {
                command: 'github-activity-dashboard.openProfile',
                title: 'Open Profile in VS Code',
                arguments: []
            };
            profileItems.push(openProfileItem);

            return profileItems;

        } catch (err: any) {
            return [new vscode.TreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
        }
    }
}

class GitHubNotificationsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private octokit: Octokit | undefined;

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        try {
            const session = await vscode.authentication.getSession('github', ['notifications'], { createIfNone: true });
            this.octokit = new Octokit({ auth: session.accessToken });
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('Could not authenticate with GitHub.');
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!this.octokit) {
            return [new vscode.TreeItem('Please authenticate with GitHub', vscode.TreeItemCollapsibleState.None)];
        }

        try {
            const notifications = await this.octokit.activity.listNotificationsForAuthenticatedUser();
            
            if (notifications.data.length === 0) {
                return [new vscode.TreeItem('No notifications', vscode.TreeItemCollapsibleState.None)];
            }

            return notifications.data.map(notification => {
                const item = new vscode.TreeItem(notification.subject.title, vscode.TreeItemCollapsibleState.None);
                item.description = notification.repository.full_name;
                item.tooltip = `${notification.subject.type}: ${notification.subject.title}\nRepository: ${notification.repository.full_name}\nUpdated: ${notification.updated_at}`;
                if (notification.subject.url) {
                    item.command = {
                        command: 'vscode.open',
                        title: 'Open Notification',
                        arguments: [vscode.Uri.parse(notification.subject.url.replace('api.github.com/repos', 'github.com').replace('/pulls/', '/pull/').replace('/issues/', '/issues/'))]
                    };
                }
                item.iconPath = notification.unread ? new vscode.ThemeIcon('mail') : new vscode.ThemeIcon('mail-read');
                return item;
            });
        } catch (err: any) {
            return [new vscode.TreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const githubActivityProvider = new GitHubActivityProvider();
    vscode.window.registerTreeDataProvider('github-activity-dashboard', githubActivityProvider);

    const githubRepoProvider = new GitHubRepoProvider();
    vscode.window.registerTreeDataProvider('github-repositories', githubRepoProvider);

    const githubHistoryProvider = new GitHubHistoryProvider();
    vscode.window.registerTreeDataProvider('github-history', githubHistoryProvider);

    const githubStarsProvider = new GitHubStarsProvider();
    vscode.window.registerTreeDataProvider('github-stars', githubStarsProvider);

    const githubNotificationsProvider = new GitHubNotificationsProvider();
    vscode.window.registerTreeDataProvider('github-notifications', githubNotificationsProvider);

    const githubProfileProvider = new GitHubProfileProvider();
    vscode.window.registerTreeDataProvider('github-profile', githubProfileProvider);

    // Auto-open profile after providers are registered and initialized
    setTimeout(() => {
        vscode.commands.executeCommand('github-activity-dashboard.openProfile');
    }, 1500); // Increased delay to ensure providers are ready

    vscode.commands.registerCommand('github-activity-dashboard.refresh', () => {
        githubActivityProvider.refresh();
        githubRepoProvider.refresh();
        githubHistoryProvider.refresh();
        githubStarsProvider.refresh();
        githubNotificationsProvider.refresh();
        githubProfileProvider.refresh();
    });

    vscode.commands.registerCommand('github-activity-dashboard.openProfile', async () => {
        // Show loading notification
        const loadingNotification = vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Loading GitHub Profile...",
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: "Authenticating..." });
                const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
                const octokit = new Octokit({ auth: session.accessToken });

                progress.report({ message: "Fetching profile..." });
                
                // Fetch user data and repositories in parallel for better performance
                const [userResponse, reposResponse] = await Promise.all([
                    octokit.users.getAuthenticated(),
                    octokit.repos.listForAuthenticatedUser({
                        sort: 'updated',
                        per_page: 20, // Reduced from 50 to load faster
                        type: 'all'
                    })
                ]);

                const userData = userResponse.data;
                const repositories = reposResponse.data;

                progress.report({ message: "Creating interface..." });

                // Create and show the webview panel immediately with loading state
                const panel = vscode.window.createWebviewPanel(
                    'githubProfile',
                    `GitHub Profile - ${userData.login}`,
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                // Show loading state immediately for better UX
                panel.webview.html = getLoadingWebviewContent(`${userData.login}'s Profile`);

                // Generate the HTML content for the profile
                panel.webview.html = getProfileWebviewContent(userData, repositories);

                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(
                    async message => {
                        switch (message.command) {
                            case 'openRepo':
                                try {
                                    const repoOwner = message.repoOwner;
                                    const repoName = message.repoName;
                                    
                                    // Create a new webview for repository browsing
                                    const repoPanel = vscode.window.createWebviewPanel(
                                        'githubRepo',
                                        `${repoOwner}/${repoName}`,
                                        vscode.ViewColumn.One,
                                        {
                                            enableScripts: true,
                                            retainContextWhenHidden: true
                                        }
                                    );

                                    // Show loading state immediately
                                    repoPanel.webview.html = getLoadingWebviewContent(`${repoOwner}/${repoName}`);

                                    // Fetch repository content
                                    const [repoData, contents] = await Promise.all([
                                        octokit.repos.get({
                                            owner: repoOwner,
                                            repo: repoName
                                        }),
                                        octokit.repos.getContent({
                                            owner: repoOwner,
                                            repo: repoName,
                                            path: ''
                                        })
                                    ]);

                                    repoPanel.webview.html = getRepoWebviewContent(repoData.data, contents.data as any[], repoOwner, repoName);
                                    
                                } catch (error: any) {
                                    vscode.window.showErrorMessage(`Failed to open repository: ${error.message}`);
                                }
                                break;
                        }
                    },
                    undefined,
                    context.subscriptions
                );

                progress.report({ message: "Complete!" });

            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to load profile: ${err.message}`);
            }
        });

        return loadingNotification;
    });

    vscode.commands.registerCommand('github-activity-dashboard.openStarredFile', async (item: StarredRepoTreeItem) => {
        if (!item.repoInfo?.owner || !item.repoInfo?.repo || !item.repoInfo?.sha) return;
        
        const octokit = new Octokit({ 
            auth: (await vscode.authentication.getSession('github', ['repo'], { createIfNone: true })).accessToken 
        });

        try {
            const blob = await octokit.git.getBlob({
                owner: item.repoInfo.owner,
                repo: item.repoInfo.repo,
                file_sha: item.repoInfo.sha
            });

            const content = Buffer.from(blob.data.content, 'base64').toString('utf8');
            const fileExtension = item.label.split('.').pop();
            const languageId = getLanguageId(fileExtension || '');
            const doc = await vscode.workspace.openTextDocument({ 
                content, 
                language: languageId 
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.createIssue', async () => {
        const title = await vscode.window.showInputBox({
            prompt: 'Enter issue title',
            placeHolder: 'Bug: Something is not working...'
        });

        if (!title) return;

        const body = await vscode.window.showInputBox({
            prompt: 'Enter issue description (optional)',
            placeHolder: 'Describe the issue...'
        });

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        try {
            const git = simpleGit(workspaceFolder.uri.fsPath);
            const remoteUrl = await git.listRemote(['--get-url', 'origin']);
            const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)(?:\.git)?/);
            
            if (!match) {
                vscode.window.showErrorMessage('Not a GitHub repository');
                return;
            }

            const [, owner, repo] = match;
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            const issue = await octokit.issues.create({
                owner,
                repo,
                title,
                body: body || ''
            });

            vscode.window.showInformationMessage(`Issue created: #${issue.data.number}`);
            githubActivityProvider.refresh();

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to create issue: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.searchRepos', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Search GitHub repositories',
            placeHolder: 'Enter search terms...'
        });

        if (!query) return;

        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            const results = await octokit.search.repos({ q: query, sort: 'stars', order: 'desc' });
            
            const quickPick = vscode.window.createQuickPick();
            quickPick.items = results.data.items.slice(0, 20).map(repo => ({
                label: repo.full_name,
                description: `⭐ ${repo.stargazers_count} | ${repo.description || 'No description'}`,
                detail: repo.html_url
            }));
            quickPick.placeholder = 'Select a repository to open';
            
            quickPick.onDidChangeSelection(selection => {
                if (selection[0]) {
                    vscode.env.openExternal(vscode.Uri.parse(selection[0].detail!));
                    quickPick.dispose();
                }
            });

            quickPick.show();

        } catch (err: any) {
            vscode.window.showErrorMessage(`Search failed: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.checkoutCommit', async (commitHash: string) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const git = simpleGit(workspaceFolder.uri.fsPath);
            try {
                await git.checkout(commitHash);
                vscode.window.showInformationMessage(`Checked out commit ${commitHash.substring(0, 7)}`);
                // Refresh all providers after checkout
                githubActivityProvider.refresh();
                githubRepoProvider.refresh();
                githubHistoryProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to checkout commit: ${err.message}`);
            }
        }
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
        const fileExtension = item.label.split('.').pop();
        const languageId = getLanguageId(fileExtension || '');
        const doc = await vscode.workspace.openTextDocument({ content, language: languageId });
        await vscode.window.showTextDocument(doc, { preview: true });
    });
}

function getProfileWebviewContent(userData: any, repositories: any[] = []): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>GitHub Profile</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
                    background-color: #0d1117;
                    color: #e6edf3;
                    line-height: 1.5;
                    overflow-x: hidden;
                }
                .container {
                    max-width: 1280px;
                    margin: 0 auto;
                    padding: 24px;
                }
                
                /* Profile Header */
                .profile-header {
                    display: flex;
                    gap: 24px;
                    margin-bottom: 32px;
                    padding: 0;
                }
                .profile-avatar-section {
                    flex-shrink: 0;
                }
                .profile-avatar {
                    width: 296px;
                    height: 296px;
                    border-radius: 50%;
                    border: 1px solid #30363d;
                }
                .profile-info {
                    flex: 1;
                    padding-top: 16px;
                }
                .profile-name {
                    font-size: 26px;
                    font-weight: 600;
                    color: #f0f6fc;
                    margin-bottom: 4px;
                }
                .profile-username {
                    font-size: 20px;
                    font-weight: 300;
                    color: #7d8590;
                    margin-bottom: 16px;
                }
                .profile-bio {
                    font-size: 16px;
                    margin-bottom: 16px;
                    color: #e6edf3;
                }
                
                /* Profile Stats */
                .profile-stats {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 16px;
                }
                .stat-item {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 14px;
                    color: #7d8590;
                }
                .stat-number {
                    font-weight: 600;
                    color: #f0f6fc;
                }
                
                /* Profile Details */
                .profile-details {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .detail-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    color: #e6edf3;
                }
                .detail-icon {
                    width: 16px;
                    height: 16px;
                    color: #7d8590;
                }
                
                /* Repositories Section */
                .repos-section {
                    margin-top: 32px;
                }
                .repos-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #21262d;
                }
                .repos-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #f0f6fc;
                }
                .repos-count {
                    background-color: #21262d;
                    color: #e6edf3;
                    font-size: 12px;
                    font-weight: 500;
                    padding: 0 6px;
                    border-radius: 2em;
                    line-height: 18px;
                }
                
                /* Repository Grid */
                .repos-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                    gap: 16px;
                }
                .repo-card {
                    border: 1px solid #21262d;
                    border-radius: 6px;
                    padding: 16px;
                    background-color: #0d1117;
                    transition: border-color 0.2s;
                    cursor: pointer;
                    position: relative;
                }
                .repo-card:hover {
                    border-color: #30363d;
                }
                .repo-header {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    margin-bottom: 8px;
                }
                .repo-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: #2f81f7;
                    text-decoration: none;
                    margin: 0;
                    line-height: 1.25;
                }
                .repo-name:hover {
                    text-decoration: underline;
                }
                .repo-visibility {
                    font-size: 12px;
                    font-weight: 500;
                    padding: 0 7px;
                    border-radius: 2em;
                    border: 1px solid #21262d;
                    color: #7d8590;
                    line-height: 18px;
                    margin-left: 8px;
                }
                .repo-visibility.public {
                    color: #7d8590;
                }
                .repo-visibility.private {
                    color: #f85149;
                    border-color: #f85149;
                }
                .repo-description {
                    font-size: 12px;
                    color: #7d8590;
                    margin-bottom: 8px;
                    line-height: 1.33;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                }
                .repo-footer {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    font-size: 12px;
                    color: #7d8590;
                }
                .repo-meta {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                .repo-language-color {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                }
                .language-javascript { background-color: #f1e05a; }
                .language-typescript { background-color: #3178c6; }
                .language-python { background-color: #3572A5; }
                .language-java { background-color: #b07219; }
                .language-html { background-color: #e34c26; }
                .language-css { background-color: #563d7c; }
                .language-c { background-color: #555555; }
                .language-cpp { background-color: #f34b7d; }
                .language-csharp { background-color: #239120; }
                .language-go { background-color: #00ADD8; }
                .language-rust { background-color: #dea584; }
                .language-php { background-color: #4F5D95; }
                .language-ruby { background-color: #701516; }
                .language-swift { background-color: #fa7343; }
                .language-kotlin { background-color: #A97BFF; }
                .language-dart { background-color: #00B4AB; }
                .language-default { background-color: #586069; }
                
                /* Star and Fork Icons */
                .star-icon, .fork-icon {
                    width: 12px;
                    height: 12px;
                    fill: currentColor;
                }
                
                /* Updated timestamp */
                .repo-updated {
                    font-size: 12px;
                    color: #7d8590;
                    margin-left: auto;
                }
                
                /* Footer */
                .profile-footer {
                    margin-top: 32px;
                    padding-top: 16px;
                    border-top: 1px solid #21262d;
                    text-align: center;
                }
                .github-link {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 5px 16px;
                    border: 1px solid #30363d;
                    border-radius: 6px;
                    background-color: #21262d;
                    color: #f0f6fc;
                    text-decoration: none;
                    font-size: 14px;
                    font-weight: 500;
                    transition: background-color 0.2s;
                }
                .github-link:hover {
                    background-color: #30363d;
                }
                
                /* Responsive */
                @media (max-width: 768px) {
                    .profile-header {
                        flex-direction: column;
                        align-items: center;
                        text-align: center;
                    }
                    .profile-avatar {
                        width: 200px;
                        height: 200px;
                    }
                    .repos-grid {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- Profile Header -->
                <div class="profile-header">
                    <div class="profile-avatar-section">
                        <img src="${userData.avatar_url}" alt="${userData.name || userData.login}" class="profile-avatar">
                    </div>
                    <div class="profile-info">
                        <h1 class="profile-name">${userData.name || userData.login}</h1>
                        <h2 class="profile-username">${userData.login}</h2>
                        ${userData.bio ? `<p class="profile-bio">${userData.bio}</p>` : ''}
                        
                        <div class="profile-stats">
                            <div class="stat-item">
                                <svg class="star-icon" viewBox="0 0 16 16">
                                    <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
                                </svg>
                                <span class="stat-number">${userData.public_repos}</span> repositories
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${userData.followers}</span> followers
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${userData.following}</span> following
                            </div>
                        </div>
                        
                        <div class="profile-details">
                            ${userData.company ? `
                                <div class="detail-item">
                                    <svg class="detail-icon" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M1.75 16A1.75 1.75 0 010 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 00.25-.25V8.285a.25.25 0 00-.111-.208l-1.055-.703a.75.75 0 11.832-1.248l1.055.703c.487.325.779.871.779 1.456v5.965A1.75 1.75 0 0114.25 16h-3.5a.75.75 0 01-.197-.026c-.099.017-.2.026-.303.026h-8.5zM9 9a.75.75 0 000-1.5H4.5a.75.75 0 000 1.5H9zM4.5 5.25a.75.75 0 000 1.5h5a.75.75 0 000-1.5h-5z"/>
                                    </svg>
                                    ${userData.company}
                                </div>
                            ` : ''}
                            ${userData.location ? `
                                <div class="detail-item">
                                    <svg class="detail-icon" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M11.536 3.464a5 5 0 010 7.072L8 14.07l-3.536-3.535a5 5 0 117.072-7.07v.001zm-4.95 7.07a3.5 3.5 0 006.895 0L8 6.062 6.586 10.534z"/>
                                        <circle cx="8" cy="6" r="2"/>
                                    </svg>
                                    ${userData.location}
                                </div>
                            ` : ''}
                            ${userData.email ? `
                                <div class="detail-item">
                                    <svg class="detail-icon" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M1.75 2A1.75 1.75 0 000 3.75v.736a.75.75 0 000 .027v7.737C0 13.216.784 14 1.75 14h12.5A1.75 1.75 0 0016 12.25v-8.5A1.75 1.75 0 0014.25 2H1.75zM14.5 4.07v-.32a.25.25 0 00-.25-.25H1.75a.25.25 0 00-.25.25v.32L8 7.88l6.5-3.81zm-13 1.74v6.441c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.809L8.38 9.397a.75.75 0 01-.76 0L1.5 5.809z"/>
                                    </svg>
                                    ${userData.email}
                                </div>
                            ` : ''}
                            ${userData.blog ? `
                                <div class="detail-item">
                                    <svg class="detail-icon" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M7.775 3.275a.75.75 0 001.06 1.06l1.25-1.25a2 2 0 112.83 2.83l-2.5 2.5a2 2 0 01-2.83 0 .75.75 0 00-1.06 1.06 3.5 3.5 0 004.95 0l2.5-2.5a3.5 3.5 0 00-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 010-2.83l2.5-2.5a2 2 0 012.83 0 .75.75 0 001.06-1.06 3.5 3.5 0 00-4.95 0l-2.5 2.5a3.5 3.5 0 004.95 4.95l1.25-1.25a.75.75 0 00-1.06-1.06l-1.25 1.25a2 2 0 01-2.83 0z"/>
                                    </svg>
                                    <a href="${userData.blog}" target="_blank" style="color: #2f81f7; text-decoration: none;">${userData.blog}</a>
                                </div>
                            ` : ''}
                            <div class="detail-item">
                                <svg class="detail-icon" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                                </svg>
                                Joined ${new Date(userData.created_at).toLocaleDateString('en-US', { 
                                    year: 'numeric', 
                                    month: 'long'
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Repositories Section -->
                <div class="repos-section">
                    <div class="repos-header">
                        <h2 class="repos-title">Repositories</h2>
                        <span class="repos-count">${repositories.length}</span>
                    </div>
                    
                    <div class="repos-grid">
                        ${repositories.map(repo => `
                            <div class="repo-card" onclick="openRepository('${repo.owner.login}', '${repo.name}')">>
                                <div class="repo-header">
                                    <div style="display: flex; align-items: center;">
                                        <h3 class="repo-name">${repo.name}</h3>
                                        <span class="repo-visibility ${repo.private ? 'private' : 'public'}">
                                            ${repo.private ? 'Private' : 'Public'}
                                        </span>
                                    </div>
                                </div>
                                ${repo.description ? `<p class="repo-description">${repo.description}</p>` : ''}
                                <div class="repo-footer">
                                    ${repo.language ? `
                                        <div class="repo-meta">
                                            <span class="repo-language-color language-${repo.language.toLowerCase()}"></span>
                                            ${repo.language}
                                        </div>
                                    ` : ''}
                                    <div class="repo-meta">
                                        <svg class="star-icon" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
                                        </svg>
                                        ${repo.stargazers_count}
                                    </div>
                                    <div class="repo-meta">
                                        <svg class="fork-icon" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878z"/>
                                        </svg>
                                        ${repo.forks_count}
                                    </div>
                                    <span class="repo-updated">Updated ${(() => {
                                        const date = new Date(repo.updated_at);
                                        const now = new Date();
                                        const diff = now.getTime() - date.getTime();
                                        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                                        
                                        if (days === 0) return 'today';
                                        if (days === 1) return 'yesterday';
                                        if (days < 30) return days + ' days ago';
                                        if (days < 365) return Math.floor(days / 30) + ' months ago';
                                        return Math.floor(days / 365) + ' years ago';
                                    })()}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Footer -->
                <div class="profile-footer">
                    <a href="${userData.html_url}" target="_blank" class="github-link">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                                        </svg>
                                        View on GitHub
                                    </a>
                                </div>
                            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function openRepository(repoOwner, repoName) {
                    vscode.postMessage({
                        command: 'openRepo',
                        repoOwner: repoOwner,
                        repoName: repoName
                    });
                }
            </script>
        </body>
        </html>
    `;
}

function getLoadingWebviewContent(title: string): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
                    background-color: #0d1117;
                    color: #e6edf3;
                    line-height: 1.5;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    flex-direction: column;
                }
                .loading-container {
                    text-align: center;
                }
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid #21262d;
                    border-top: 3px solid #2f81f7;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 16px auto;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .loading-text {
                    font-size: 16px;
                    color: #7d8590;
                }
            </style>
        </head>
        <body>
            <div class="loading-container">
                <div class="spinner"></div>
                <div class="loading-text">Loading ${title}...</div>
            </div>
        </body>
        </html>
    `;
}

function getRepoWebviewContent(repoData: any, contents: any[], owner: string, repoName: string): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${owner}/${repoName}</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
                    background-color: #0d1117;
                    color: #e6edf3;
                    line-height: 1.5;
                }
                .container {
                    max-width: 1280px;
                    margin: 0 auto;
                    padding: 24px;
                }
                .repo-header {
                    border-bottom: 1px solid #21262d;
                    padding-bottom: 16px;
                    margin-bottom: 24px;
                }
                .repo-title {
                    font-size: 20px;
                    font-weight: 600;
                    color: #2f81f7;
                    margin-bottom: 8px;
                }
                .repo-description {
                    color: #7d8590;
                    margin-bottom: 16px;
                }
                .repo-stats {
                    display: flex;
                    gap: 16px;
                    font-size: 14px;
                    color: #7d8590;
                }
                .file-list {
                    background-color: #161b22;
                    border: 1px solid #30363d;
                    border-radius: 6px;
                    overflow: hidden;
                }
                .file-item {
                    display: flex;
                    align-items: center;
                    padding: 8px 16px;
                    border-bottom: 1px solid #21262d;
                    cursor: pointer;
                    transition: background-color 0.1s;
                }
                .file-item:hover {
                    background-color: #21262d;
                }
                .file-item:last-child {
                    border-bottom: none;
                }
                .file-icon {
                    margin-right: 8px;
                    width: 16px;
                    height: 16px;
                }
                .file-name {
                    color: #2f81f7;
                    text-decoration: none;
                    font-weight: 600;
                }
                .file-name:hover {
                    text-decoration: underline;
                }
                .folder-name {
                    color: #2f81f7;
                    text-decoration: none;
                    font-weight: 600;
                }
                .folder-name:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="repo-header">
                    <h1 class="repo-title">${owner}/${repoName}</h1>
                    ${repoData.description ? `<p class="repo-description">${repoData.description}</p>` : ''}
                    <div class="repo-stats">
                        <span>⭐ ${repoData.stargazers_count}</span>
                        <span>🍴 ${repoData.forks_count}</span>
                        <span>👁️ ${repoData.watchers_count}</span>
                        ${repoData.language ? `<span>💻 ${repoData.language}</span>` : ''}
                    </div>
                </div>
                
                <div class="file-list">
                    ${contents.map(item => `
                        <div class="file-item">
                            <div class="file-icon">
                                ${item.type === 'dir' ? '📁' : '📄'}
                            </div>
                            <a href="#" class="${item.type === 'dir' ? 'folder-name' : 'file-name'}" 
                               onclick="openFile('${item.path}', '${item.type}')">
                                ${item.name}
                            </a>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                function openFile(path, type) {
                    if (type === 'file') {
                        vscode.postMessage({
                            command: 'openFile',
                            owner: '${owner}',
                            repo: '${repoName}',
                            path: path
                        });
                    } else {
                        vscode.postMessage({
                            command: 'openFolder',
                            owner: '${owner}',
                            repo: '${repoName}',
                            path: path
                        });
                    }
                }
            </script>
        </body>
        </html>
    `;
}

function getLanguageId(extension: string): string {
    const languageMap: { [key: string]: string } = {
        'js': 'javascript',
        'ts': 'typescript',
        'jsx': 'javascriptreact',
        'tsx': 'typescriptreact',
        'py': 'python',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'cs': 'csharp',
        'php': 'php',
        'rb': 'ruby',
        'go': 'go',
        'rs': 'rust',
        'swift': 'swift',
        'kt': 'kotlin',
        'scala': 'scala',
        'sh': 'shellscript',
        'ps1': 'powershell',
        'sql': 'sql',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'sass': 'sass',
        'less': 'less',
        'json': 'json',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml',
        'md': 'markdown',
        'txt': 'plaintext'
    };
    return languageMap[extension.toLowerCase()] || 'plaintext';
}

export function deactivate() {}
