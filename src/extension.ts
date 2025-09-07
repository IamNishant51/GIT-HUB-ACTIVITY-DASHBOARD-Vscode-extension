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
            this.command = {
                command: 'github-activity-dashboard.openRepo',
                title: 'Open Repository in VS Code',
                arguments: [repoInfo.owner, repoInfo.repo]
            };
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
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('Could not authenticate with GitHub.');
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

class ProfileRepoTreeItem extends vscode.TreeItem {
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
                command: 'github-activity-dashboard.openProfileFile',
                title: 'Open File',
                arguments: [this]
            };
            this.iconPath = new vscode.ThemeIcon('file');
        } else if (repoInfo?.type === 'dir') {
            this.iconPath = new vscode.ThemeIcon('folder');
        } else if (repoInfo?.type === 'repo') {
            this.iconPath = new vscode.ThemeIcon('repo');
            this.contextValue = 'profileRepo';
        }
    }
}

class GitHubProfileReposProvider implements vscode.TreeDataProvider<ProfileRepoTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProfileRepoTreeItem | undefined | null | void> = new vscode.EventEmitter<ProfileRepoTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProfileRepoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private octokit: Octokit | undefined;
    private repositories: any[] = [];

    constructor() {
        this.initializeOctokit();
    }

    private async initializeOctokit() {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            this.octokit = new Octokit({ auth: session.accessToken });
            await this.loadRepositories();
            this.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('Could not authenticate with GitHub.');
        }
    }

    private async loadRepositories() {
        if (!this.octokit) return;
        
        try {
            const reposResponse = await this.octokit.repos.listForAuthenticatedUser({
                sort: 'updated',
                per_page: 100
            });
            this.repositories = reposResponse.data;
        } catch (error) {
            console.error('Error loading repositories:', error);
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ProfileRepoTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProfileRepoTreeItem): Promise<ProfileRepoTreeItem[]> {
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
                            new ProfileRepoTreeItem(
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
                    return [new ProfileRepoTreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
                }
            }
            return [];
        } else {
            // It's the root, show user's repositories
            return this.repositories.map(repo => {
                const item = new ProfileRepoTreeItem(
                    repo.name, 
                    vscode.TreeItemCollapsibleState.Collapsed,
                    {
                        owner: repo.owner.login,
                        repo: repo.name,
                        type: 'repo',
                        url: repo.html_url
                    }
                );
                item.description = repo.private ? 'Private' : 'Public';
                item.tooltip = `${repo.full_name}\n${repo.description || 'No description'}\n⭐ ${repo.stargazers_count} stars • 🍴 ${repo.forks_count} forks`;
                return item;
            });
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

class GitHubBranchesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
            const username = user.data.login;

            // Get user's repositories
            const repos = await this.octokit.repos.listForAuthenticatedUser({ per_page: 10 });

            const branchItems: vscode.TreeItem[] = [];

            for (const repo of repos.data) {
                try {
                    const branches = await this.octokit.repos.listBranches({
                        owner: repo.owner.login,
                        repo: repo.name,
                        per_page: 5
                    });

                    const repoItem = new vscode.TreeItem(repo.name, vscode.TreeItemCollapsibleState.Collapsed);
                    repoItem.description = `${branches.data.length} branches`;
                    repoItem.tooltip = `Repository: ${repo.full_name}\nBranches: ${branches.data.length}`;
                    repoItem.iconPath = new vscode.ThemeIcon('repo');

                    // Store repo info for expansion
                    (repoItem as any).repoInfo = {
                        owner: repo.owner.login,
                        repo: repo.name,
                        branches: branches.data
                    };

                    branchItems.push(repoItem);
                } catch (error) {
                    // Skip repos we can't access
                }
            }

            if (branchItems.length === 0) {
                return [new vscode.TreeItem('No repositories found', vscode.TreeItemCollapsibleState.None)];
            }

            return branchItems;
        } catch (err: any) {
            return [new vscode.TreeItem(`Error: ${err.message}`, vscode.TreeItemCollapsibleState.None)];
        }
    }

    async getBranchChildren(repoInfo: any): Promise<vscode.TreeItem[]> {
        return repoInfo.branches.map((branch: any) => {
            const item = new vscode.TreeItem(branch.name, vscode.TreeItemCollapsibleState.None);
            item.description = branch.protected ? 'Protected' : '';
            item.tooltip = `Branch: ${branch.name}\nRepository: ${repoInfo.owner}/${repoInfo.repo}\nProtected: ${branch.protected}`;
            item.iconPath = new vscode.ThemeIcon('git-branch');

            item.command = {
                command: 'github-activity-dashboard.switchBranch',
                title: 'Switch to Branch',
                arguments: [repoInfo.owner, repoInfo.repo, branch.name]
            };

            return item;
        });
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

    // Create tree view for profile to enable revealing
    const profileTreeView = vscode.window.createTreeView('github-profile', {
        treeDataProvider: githubProfileProvider
    });
    context.subscriptions.push(profileTreeView);

    const githubProfileReposProvider = new GitHubProfileReposProvider();
    vscode.window.registerTreeDataProvider('github-profile-repos', githubProfileReposProvider);

    // Create and store reference to the Profile Repositories tree view
    const profileReposTreeView = vscode.window.createTreeView('github-profile-repos', {
        treeDataProvider: githubProfileReposProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(profileReposTreeView);

    console.log('Profile Repositories tree view created:', profileReposTreeView ? 'YES' : 'NO');

    // Automatically reveal the profile section when extension is activated
    setTimeout(() => {
        vscode.commands.executeCommand('workbench.view.extension.github-dashboard-container');
        vscode.commands.executeCommand('github-activity-dashboard.refresh');
        
        // Reveal the profile view
        profileTreeView.reveal(null as any, { select: true, focus: true });
    }, 1000);

    vscode.commands.registerCommand('github-activity-dashboard.refresh', () => {
        githubActivityProvider.refresh();
        githubRepoProvider.refresh();
        githubHistoryProvider.refresh();
        githubStarsProvider.refresh();
        githubNotificationsProvider.refresh();
        githubProfileProvider.refresh();
        githubProfileReposProvider.refresh();
    });

    vscode.commands.registerCommand('github-activity-dashboard.openProfile', async () => {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });
            const user = await octokit.users.getAuthenticated();
            const userData = user.data;

            // Fetch user's repositories
            let repositories: any[] = [];
            try {
                const reposResponse = await octokit.repos.listForAuthenticatedUser({
                    sort: 'updated',
                    per_page: 50
                });
                repositories = reposResponse.data;
            } catch (error) {
                console.log('Could not fetch repositories:', error);
            }

            // Fetch user's organizations
            let organizations: any[] = [];
            try {
                const orgsResponse = await octokit.orgs.listForAuthenticatedUser();
                organizations = orgsResponse.data;
            } catch (error) {
                console.log('Could not fetch organizations:', error);
            }

            // Fetch user's pinned repositories (using GraphQL since REST API doesn't have this)
            let pinnedRepos: any[] = [];
            try {
                const pinnedQuery = `
                    query {
                        user(login: "${userData.login}") {
                            pinnedItems(first: 6, types: REPOSITORY) {
                                nodes {
                                    ... on Repository {
                                        name
                                        description
                                        url
                                        stargazers {
                                            totalCount
                                        }
                                        forks {
                                            totalCount
                                        }
                                        primaryLanguage {
                                            name
                                            color
                                        }
                                        isPrivate
                                    }
                                }
                            }
                        }
                    }
                `;
                const graphqlResponse: any = await octokit.graphql(pinnedQuery);
                pinnedRepos = graphqlResponse.user.pinnedItems.nodes;
            } catch (error) {
                console.log('Could not fetch pinned repos:', error);
            }

            // Fetch recent activity (events)
            let recentEvents: any[] = [];
            try {
                const eventsResponse = await octokit.activity.listEventsForAuthenticatedUser({
                    username: userData.login,
                    per_page: 20
                });
                recentEvents = eventsResponse.data;
            } catch (error) {
                console.log('Could not fetch recent events:', error);
            }

            // Fetch user's profile README
            let profileReadme = null;
            try {
                const readmeResponse = await octokit.repos.getContent({
                    owner: userData.login,
                    repo: userData.login,
                    path: 'README.md'
                });
                if ('content' in readmeResponse.data) {
                    profileReadme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf8');
                }
            } catch (error) {
                console.log('No profile README found');
            }

            // Calculate language statistics
            const languageStats: { [key: string]: number } = {};
            repositories.forEach(repo => {
                if (repo.language) {
                    languageStats[repo.language] = (languageStats[repo.language] || 0) + 1;
                }
            });
            const topLanguages = Object.entries(languageStats)
                .sort(([,a]: [string, number], [,b]: [string, number]) => b - a)
                .slice(0, 8);

            // Create and show the webview panel
        const panel = vscode.window.createWebviewPanel(
                'githubProfile',
                `GitHub Profile - ${userData.login}`,
                vscode.ViewColumn.One,
                {
            enableScripts: true
                }
            );

            // Generate the HTML content for the profile
            panel.webview.html = getProfileWebviewContent(panel.webview, userData, repositories, organizations, pinnedRepos, recentEvents, topLanguages, profileReadme);

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    console.log('Received message from webview:', message);
                    switch (message.command) {
                        case 'openRepo':
                            try {
                                console.log('Processing openRepo command');
                                const repoUrl = message.repoUrl;
                                const repoName = message.repoName;
                                console.log(`Repository URL: ${repoUrl}, Name: ${repoName}`);

                                // Extract owner and repo from the URL
                                // repoUrl is like: https://github.com/owner/repo.git
                                const urlMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
                                console.log('URL match result:', urlMatch);
                                if (urlMatch) {
                                    const [, owner, repo] = urlMatch;
                                    console.log(`Extracted owner: ${owner}, repo: ${repo}`);

                                    // Use the command to expand the repository
                                    await vscode.commands.executeCommand('github-activity-dashboard.expandProfileRepo', owner, repo);
                                } else {
                                    console.log('Failed to parse repository URL');
                                    vscode.window.showErrorMessage('Invalid repository URL format');
                                }
                            } catch (error: any) {
                                console.error('Error in openRepo handler:', error);
                                vscode.window.showErrorMessage(`Failed to open repository: ${error.message}`);
                            }
                            break;
                        case 'openOrg':
                            try {
                                await vscode.commands.executeCommand('github-activity-dashboard.openOrganizationProfile', message.orgName);
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open organization: ${error.message}`);
                            }
                            break;
                        case 'openEvent':
                            try {
                                await vscode.commands.executeCommand('github-activity-dashboard.openEventDetails', message.eventUrl);
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open event: ${error.message}`);
                            }
                            break;
                        case 'openProfile':
                            try {
                                await vscode.commands.executeCommand('github-activity-dashboard.openUserProfile', message.username);
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open profile: ${error.message}`);
                            }
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to load profile: ${err.message}`);
        }
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

    vscode.commands.registerCommand('github-activity-dashboard.openProfileFile', async (item: ProfileRepoTreeItem) => {
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

    vscode.commands.registerCommand('github-activity-dashboard.openRepo', async (owner: string, repo: string) => {
        try {
            const repoUrl = `https://github.com/${owner}/${repo}`;
            const uri = vscode.Uri.parse(repoUrl);
            await vscode.env.openExternal(uri);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open repository: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.expandProfileRepo', async (owner: string, repo: string) => {
        try {
            console.log(`Expanding repository: ${owner}/${repo}`);
            
            // Create a new tree item for the repository
            const repoItem = new ProfileRepoTreeItem(
                repo,
                vscode.TreeItemCollapsibleState.Expanded,
                {
                    owner: owner,
                    repo: repo,
                    type: 'repo',
                    url: `https://github.com/${owner}/${repo}`
                }
            );
            
            // Add it to the profile repos tree view
            if (profileReposTreeView) {
                // Refresh the tree to show the new repository
                githubProfileReposProvider.refresh();
                
                // Try to reveal the new repository in the tree
                await profileReposTreeView.reveal(repoItem, { select: true, focus: true });
            }
            
            vscode.window.showInformationMessage(`Repository ${owner}/${repo} expanded in profile view`);
        } catch (error: any) {
            console.error('Error expanding profile repo:', error);
            vscode.window.showErrorMessage(`Failed to expand repository: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.openOrganizationProfile', async (orgName: string) => {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            // Get organization details
            const orgResponse = await octokit.orgs.get({ org: orgName });
            const orgData = orgResponse.data;

            // Get organization repositories
            const reposResponse = await octokit.repos.listForOrg({
                org: orgName,
                sort: 'updated',
                per_page: 20
            });
            const repositories = reposResponse.data;

            // Create webview panel for organization
            const panel = vscode.window.createWebviewPanel(
                'githubOrganization',
                `Organization - ${orgData.name || orgData.login}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            // Generate HTML content for organization profile
            panel.webview.html = getOrganizationWebviewContent(panel.webview, orgData, repositories);

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'openRepo':
                            try {
                                const repoUrl = message.repoUrl;
                                const repoName = message.repoName;
                                const urlMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
                                if (urlMatch) {
                                    const [, owner, repo] = urlMatch;
                                    await vscode.commands.executeCommand('github-activity-dashboard.expandProfileRepo', owner, repo);
                                }
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open repository: ${error.message}`);
                            }
                            break;
                        case 'openOrgProfile':
                            try {
                                await vscode.commands.executeCommand('github-activity-dashboard.openUserProfile', message.username);
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open profile: ${error.message}`);
                            }
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load organization: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.openEventDetails', async (eventUrl: string) => {
        try {
            // Extract repo information from event URL
            const urlMatch = eventUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (!urlMatch) {
                vscode.window.showErrorMessage('Invalid event URL format');
                return;
            }

            const [, owner, repo] = urlMatch;

            // Open the repository in VS Code
            await vscode.commands.executeCommand('github-activity-dashboard.expandProfileRepo', owner, repo);

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open event: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.openUserProfile', async (username: string) => {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            // Get user details
            const userResponse = await octokit.users.getByUsername({ username });
            const userData = userResponse.data;

            // Get user's repositories
            const reposResponse = await octokit.repos.listForUser({
                username,
                sort: 'updated',
                per_page: 20
            });
            const repositories = reposResponse.data;

            // Create webview panel for user profile
            const panel = vscode.window.createWebviewPanel(
                'githubUserProfile',
                `Profile - ${userData.name || userData.login}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            // Generate HTML content for user profile
            panel.webview.html = getUserProfileWebviewContent(panel.webview, userData, repositories);

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'openRepo':
                            try {
                                const repoUrl = message.repoUrl;
                                const repoName = message.repoName;
                                const urlMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
                                if (urlMatch) {
                                    const [, owner, repo] = urlMatch;
                                    await vscode.commands.executeCommand('github-activity-dashboard.expandProfileRepo', owner, repo);
                                }
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open repository: ${error.message}`);
                            }
                            break;
                        case 'openProfile':
                            try {
                                await vscode.commands.executeCommand('github-activity-dashboard.openUserProfile', message.username);
                            } catch (error: any) {
                                vscode.window.showErrorMessage(`Failed to open profile: ${error.message}`);
                            }
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );

        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load user profile: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.viewWorkflowRuns', async (owner: string, repo: string) => {
        try {
            const workflowUrl = `https://github.com/${owner}/${repo}/actions`;
            await vscode.env.openExternal(vscode.Uri.parse(workflowUrl));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open workflow runs: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.createPullRequest', async () => {
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
            const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
            
            const title = await vscode.window.showInputBox({
                prompt: 'Enter pull request title',
                placeHolder: 'Fix bug in authentication...'
            });

            if (!title) return;

            const body = await vscode.window.showInputBox({
                prompt: 'Enter pull request description (optional)',
                placeHolder: 'This PR fixes the authentication issue...'
            });

            const baseBranch = await vscode.window.showInputBox({
                prompt: 'Enter base branch',
                placeHolder: 'main',
                value: 'main'
            });

            if (!baseBranch) return;

            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            const pr = await octokit.pulls.create({
                owner,
                repo,
                title,
                body: body || '',
                head: currentBranch,
                base: baseBranch
            });

            vscode.window.showInformationMessage(`Pull request created: #${pr.data.number}`);
            vscode.env.openExternal(vscode.Uri.parse(pr.data.html_url));

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to create pull request: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.viewPullRequest', async (repoFullName: string, prNumber: number) => {
        try {
            const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
            await vscode.env.openExternal(vscode.Uri.parse(prUrl));
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open pull request: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.createBranch', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        try {
            const branchName = await vscode.window.showInputBox({
                prompt: 'Enter new branch name',
                placeHolder: 'feature/new-feature'
            });

            if (!branchName) return;

            const git = simpleGit(workspaceFolder.uri.fsPath);
            await git.checkoutLocalBranch(branchName);
            
            vscode.window.showInformationMessage(`Branch '${branchName}' created and checked out`);

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to create branch: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.switchBranch', async (owner: string, repo: string, branchName: string) => {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const git = simpleGit(workspaceFolder.uri.fsPath);
                await git.checkout(branchName);
                vscode.window.showInformationMessage(`Switched to branch '${branchName}'`);
            } else {
                // If no workspace, just show info
                vscode.window.showInformationMessage(`Branch: ${branchName} in ${owner}/${repo}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to switch branch: ${error.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.createRelease', async () => {
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
            const tags = await git.tags();
            const latestTag = tags.latest || 'v1.0.0';

            const tagName = await vscode.window.showInputBox({
                prompt: 'Enter tag name for release',
                placeHolder: 'v1.1.0',
                value: latestTag
            });

            if (!tagName) return;

            const title = await vscode.window.showInputBox({
                prompt: 'Enter release title',
                placeHolder: 'Release v1.1.0'
            });

            if (!title) return;

            const body = await vscode.window.showInputBox({
                prompt: 'Enter release description (optional)',
                placeHolder: 'This release includes...'
            });

            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            const release = await octokit.repos.createRelease({
                owner,
                repo,
                tag_name: tagName,
                name: title,
                body: body || '',
                draft: false,
                prerelease: tagName.includes('beta') || tagName.includes('alpha')
            });

            vscode.window.showInformationMessage(`Release created: ${release.data.tag_name}`);
            vscode.env.openExternal(vscode.Uri.parse(release.data.html_url));

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to create release: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.viewRepositoryStats', async () => {
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

            const [repoData, contributors, languages] = await Promise.all([
                octokit.repos.get({ owner, repo }),
                octokit.repos.listContributors({ owner, repo }),
                octokit.repos.listLanguages({ owner, repo })
            ]);

            const stats = repoData.data;
            const totalContributors = contributors.data.length;
            const languageStats = Object.entries(languages.data)
                .sort(([,a]: any, [,b]: any) => b - a)
                .slice(0, 5)
                .map(([lang, bytes]: any) => `${lang}: ${Math.round(bytes / 1024)} KB`)
                .join(', ');

            const message = `📊 Repository Statistics for ${owner}/${repo}:
⭐ Stars: ${stats.stargazers_count}
🍴 Forks: ${stats.forks_count}
👀 Watchers: ${stats.watchers_count}
🐛 Open Issues: ${stats.open_issues_count}
👥 Contributors: ${totalContributors}
💻 Languages: ${languageStats}
📅 Created: ${new Date(stats.created_at).toLocaleDateString()}
🔄 Updated: ${new Date(stats.updated_at).toLocaleDateString()}`;

            vscode.window.showInformationMessage(message, 'View on GitHub').then(selection => {
                if (selection === 'View on GitHub') {
                    vscode.env.openExternal(vscode.Uri.parse(stats.html_url));
                }
            });

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to get repository stats: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.searchCode', async () => {
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

            const query = await vscode.window.showInputBox({
                prompt: 'Enter search query',
                placeHolder: 'function login'
            });

            if (!query) return;

            const searchUrl = `https://github.com/${owner}/${repo}/search?q=${encodeURIComponent(query)}&type=code`;
            await vscode.env.openExternal(vscode.Uri.parse(searchUrl));

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to search code: ${err.message}`);
        }
    });

    vscode.commands.registerCommand('github-activity-dashboard.createGist', async () => {
        try {
            const filename = await vscode.window.showInputBox({
                prompt: 'Enter filename',
                placeHolder: 'example.js'
            });

            if (!filename) return;

            const content = await vscode.window.showInputBox({
                prompt: 'Enter gist content',
                placeHolder: 'console.log("Hello, World!");'
            });

            if (!content) return;

            const description = await vscode.window.showInputBox({
                prompt: 'Enter gist description (optional)',
                placeHolder: 'A simple example'
            });

            const isPublic = await vscode.window.showQuickPick(['Public', 'Secret'], {
                placeHolder: 'Choose visibility'
            });

            if (!isPublic) return;

            const session = await vscode.authentication.getSession('github', ['gist'], { createIfNone: true });
            const octokit = new Octokit({ auth: session.accessToken });

            const gist = await octokit.gists.create({
                description: description || '',
                public: isPublic === 'Public',
                files: {
                    [filename]: {
                        content: content
                    }
                }
            });

            vscode.window.showInformationMessage(`Gist created successfully!`);
            if (gist.data.html_url) {
                vscode.env.openExternal(vscode.Uri.parse(gist.data.html_url));
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to create gist: ${err.message}`);
        }
    });
}

function getProfileWebviewContent(webview: vscode.Webview, userData: any, repositories: any[] = [], organizations: any[] = [], pinnedRepos: any[] = [], recentEvents: any[] = [], topLanguages: [string, number][] = [], profileReadme: string | null = null): string {
    const nonce = getNonce();
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
                
                /* Organizations Section */
                .orgs-section {
                    margin-top: 32px;
                }
                .orgs-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #21262d;
                }
                .orgs-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #f0f6fc;
                }
                .orgs-count {
                    background-color: #21262d;
                    color: #e6edf3;
                    font-size: 12px;
                    font-weight: 500;
                    padding: 0 6px;
                    border-radius: 2em;
                    line-height: 18px;
                }
                .orgs-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 12px;
                }
                .org-card {
                    border: 1px solid #21262d;
                    border-radius: 6px;
                    padding: 12px;
                    background-color: #0d1117;
                    transition: border-color 0.2s;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .org-card:hover {
                    border-color: #30363d;
                }
                .org-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 6px;
                    border: 1px solid #30363d;
                }
                .org-info h4 {
                    font-size: 14px;
                    font-weight: 600;
                    color: #2f81f7;
                    margin: 0 0 2px 0;
                }
                .org-info p {
                    font-size: 12px;
                    color: #7d8590;
                    margin: 0;
                }
                
                /* Pinned Repositories Section */
                .pinned-section {
                    margin-top: 32px;
                }
                .pinned-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #21262d;
                }
                .pinned-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #f0f6fc;
                }
                .pinned-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 16px;
                }
                .pinned-card {
                    border: 1px solid #21262d;
                    border-radius: 6px;
                    padding: 16px;
                    background-color: #0d1117;
                    transition: border-color 0.2s;
                    cursor: pointer;
                }
                .pinned-card:hover {
                    border-color: #30363d;
                }
                .pinned-header-row {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    margin-bottom: 8px;
                }
                .pinned-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: #2f81f7;
                    text-decoration: none;
                    margin: 0;
                }
                .pinned-visibility {
                    font-size: 12px;
                    font-weight: 500;
                    padding: 0 7px;
                    border-radius: 2em;
                    border: 1px solid #21262d;
                    color: #7d8590;
                    line-height: 18px;
                }
                .pinned-description {
                    font-size: 12px;
                    color: #7d8590;
                    margin-bottom: 8px;
                    line-height: 1.33;
                }
                .pinned-footer {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    font-size: 12px;
                    color: #7d8590;
                }
                
                /* Activity Section */
                .activity-section {
                    margin-top: 32px;
                }
                .activity-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #21262d;
                }
                .activity-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #f0f6fc;
                }
                .activity-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .activity-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px;
                    border: 1px solid #21262d;
                    border-radius: 6px;
                    background-color: #0d1117;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }
                .activity-item:hover {
                    border-color: #30363d;
                }
                .activity-icon {
                    width: 16px;
                    height: 16px;
                    color: #7d8590;
                    flex-shrink: 0;
                }
                .activity-content {
                    flex: 1;
                    font-size: 12px;
                    color: #e6edf3;
                }
                .activity-repo {
                    font-weight: 500;
                    color: #2f81f7;
                }
                .activity-time {
                    font-size: 11px;
                    color: #7d8590;
                }
                
                /* Languages Section */
                .languages-section {
                    margin-top: 32px;
                }
                .languages-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #21262d;
                }
                .languages-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #f0f6fc;
                }
                .languages-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .language-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 8px;
                    border-radius: 12px;
                    background-color: #21262d;
                    font-size: 12px;
                    color: #e6edf3;
                }
                .language-color {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                }
                
                /* Profile README Section */
                .readme-section {
                    margin-top: 32px;
                }
                .readme-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #21262d;
                               }
                .readme-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #f0f6fc;
                }
                .readme-content {
                    border: 1px solid #21262d;
                    border-radius: 6px;
                    padding: 16px;
                    background-color: #0d1117;
                    font-size: 14px;
                    line-height: 1.5;
                    color: #e6edf3;
                    overflow-x: auto;
                }
                .readme-content h1,
                .readme-content h2,
                .readme-content h3 {
                    color: #f0f6fc;
                    margin-top: 16px;
                    margin-bottom: 8px;
                }
                .readme-content h1 { font-size: 20px; }
                .readme-content h2 { font-size: 18px; }
                .readme-content h3 { font-size: 16px; }
                .readme-content code {
                    background-color: #21262d;
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                    font-size: 12px;
                }
                .readme-content pre {
                    background-color: #21262d;
                    padding: 12px;
                    border-radius: 6px;
                    overflow-x: auto;
                    margin: 8px 0;
                }
                .readme-content pre code {
                    background-color: transparent;
                    padding: 0;
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
                            <div class="repo-card" onclick="openRepository('${repo.clone_url}', '${repo.name}')">
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
                                            <span class="repo-language-color" style="background-color: ${getLanguageColor(repo.language)}"></span>
                                            ${repo.language}
                                        </div>
                                    ` : ''}
                                    <div class="repo-meta">
                                        ⭐ ${repo.stargazers_count}
                                    </div>
                                    <div class="repo-meta">
                                        🍴 ${repo.forks_count}
                                    </div>
                                    <span>Updated ${(() => {
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

                <div class="user-footer">
                    <a href="#" class="github-link" onclick="openProfile('${userData.login}')">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        View Profile in VS Code
                    </a>
                </div>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                function openRepository(repoUrl, repoName) {
                    vscode.postMessage({
                        command: 'openRepo',
                        repoUrl: repoUrl,
                        repoName: repoName
                    });
                }

                function openProfile(username) {
                    vscode.postMessage({
                        command: 'openProfile',
                        username: username
                    });
                }
            </script>
        </body>
        </html>
    `;
}

function getOrganizationWebviewContent(webview: vscode.Webview, orgData: any, repositories: any[] = []): string {
    const nonce = getNonce();
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>Organization Profile</title>
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

                .org-header {
                    display: flex;
                    gap: 24px;
                    margin-bottom: 32px;
                    padding: 0;
                }
                .org-avatar {
                    width: 200px;
                    height: 200px;
                    border-radius: 6px;
                    border: 1px solid #30363d;
                }
                .org-info {
                    flex: 1;
                    padding-top: 16px;
                }
                .org-name {
                    font-size: 32px;
                    font-weight: 600;
                    color: #f0f6fc;
                    margin-bottom: 8px;
                }
                .org-login {
                    font-size: 20px;
                    font-weight: 300;
                    color: #7d8590;
                    margin-bottom: 16px;
                }
                .org-description {
                    font-size: 16px;
                    margin-bottom: 16px;
                    color: #e6edf3;
                }

                .org-stats {
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

                .org-footer {
                    margin-top: 32px;
                    text-align: center;
                }
                .github-link {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    color: #2f81f7;
                    text-decoration: none;
                    font-size: 14px;
                    padding: 8px 16px;
                    border: 1px solid #30363d;
                    border-radius: 6px;
                    transition: all 0.2s;
                }
                .github-link:hover {
                    background-color: #21262d;
                    border-color: #30363d;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="org-header">
                    <div>
                        <img src="${orgData.avatar_url}" alt="${orgData.login}" class="org-avatar">
                    </div>
                    <div class="org-info">
                        <h1 class="org-name">${orgData.name || orgData.login}</h1>
                        <h2 class="org-login">${orgData.login}</h2>
                        ${orgData.description ? `<p class="org-description">${orgData.description}</p>` : ''}

                        <div class="org-stats">
                            <div class="stat-item">
                                <span class="stat-number">${orgData.public_repos}</span> repositories
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${orgData.followers}</span> followers
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${orgData.following}</span> following
                            </div>
                        </div>
                    </div>
                </div>

                <div class="repos-section">
                    <div class="repos-header">
                        <h2 class="repos-title">Repositories</h2>
                        <span class="repos-count">${repositories.length}</span>
                    </div>

                    <div class="repos-grid">
                        ${repositories.map(repo => `
                            <div class="repo-card" onclick="openRepository('${repo.clone_url}', '${repo.name}')">
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
                                            <span class="repo-language-color" style="background-color: ${getLanguageColor(repo.language)}"></span>
                                            ${repo.language}
                                        </div>
                                    ` : ''}
                                    <div class="repo-meta">
                                        ⭐ ${repo.stargazers_count}
                                    </div>
                                    <div class="repo-meta">
                                        🍴 ${repo.forks_count}
                                    </div>
                                    <span>Updated ${(() => {
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

                <div class="org-footer">
                    <a href="#" class="github-link" onclick="openProfile('${orgData.login}')">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        View Profile in VS Code
                    </a>
                </div>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                function openRepository(repoUrl, repoName) {
                    vscode.postMessage({
                        command: 'openRepo',
                        repoUrl: repoUrl,
                        repoName: repoName
                    });
                }

                function openProfile(username) {
                    vscode.postMessage({
                        command: 'openProfile',
                        username: username
                    });
                }
            </script>
        </body>
        </html>
    `;
}

function getUserProfileWebviewContent(webview: vscode.Webview, userData: any, repositories: any[] = []): string {
    const nonce = getNonce();
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>User Profile</title>
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

                .user-header {
                    display: flex;
                    gap: 24px;
                    margin-bottom: 32px;
                    padding: 0;
                }
                .user-avatar {
                    width: 200px;
                    height: 200px;
                    border-radius: 50%;
                    border: 1px solid #30363d;
                }
                .user-info {
                    flex: 1;
                    padding-top: 16px;
                }
                .user-name {
                    font-size: 32px;
                    font-weight: 600;
                    color: #f0f6fc;
                    margin-bottom: 8px;
                }
                .user-login {
                    font-size: 20px;
                    font-weight: 300;
                    color: #7d8590;
                    margin-bottom: 16px;
                }
                .user-bio {
                    font-size: 16px;
                    margin-bottom: 16px;
                    color: #e6edf3;
                }

                .user-stats {
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

                .user-footer {
                    margin-top: 32px;
                    text-align: center;
                }
                .github-link {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    color: #2f81f7;
                    text-decoration: none;
                    font-size: 14px;
                    padding: 8px 16px;
                    border: 1px solid #30363d;
                    border-radius: 6px;
                    transition: all 0.2s;
                }
                .github-link:hover {
                    background-color: #21262d;
                    border-color: #30363d;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="user-header">
                    <div>
                        <img src="${userData.avatar_url}" alt="${userData.login}" class="user-avatar">
                    </div>
                    <div class="user-info">
                        <h1 class="user-name">${userData.name || userData.login}</h1>
                        <h2 class="user-login">${userData.login}</h2>
                        ${userData.bio ? `<p class="user-bio">${userData.bio}</p>` : ''}

                        <div class="user-stats">
                            <div class="stat-item">
                                <span class="stat-number">${userData.public_repos}</span> repositories
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${userData.followers}</span> followers
                            </div>
                            <div class="stat-item">
                                <span class="stat-number">${userData.following}</span> following
                            </div>
                        </div>
                    </div>
                </div>

                <div class="repos-section">
                    <div class="repos-header">
                        <h2 class="repos-title">Repositories</h2>
                        <span class="repos-count">${repositories.length}</span>
                    </div>

                    <div class="repos-grid">
                        ${repositories.map(repo => `
                            <div class="repo-card" onclick="openRepository('${repo.clone_url}', '${repo.name}')">
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
                                            <span class="repo-language-color" style="background-color: ${getLanguageColor(repo.language)}"></span>
                                            ${repo.language}
                                        </div>
                                    ` : ''}
                                    <div class="repo-meta">
                                        ⭐ ${repo.stargazers_count}
                                    </div>
                                    <div class="repo-meta">
                                        🍴 ${repo.forks_count}
                                    </div>
                                    <span>Updated ${(() => {
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

                <div class="user-footer">
                    <a href="#" class="github-link" onclick="openProfile('${userData.login}')">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        View Profile in VS Code
                    </a>
                </div>
            </div>

            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();

                function openRepository(repoUrl, repoName) {
                    vscode.postMessage({
                        command: 'openRepo',
                        repoUrl: repoUrl,
                        repoName: repoName
                    });
                }

                function openProfile(username) {
                    vscode.postMessage({
                        command: 'openProfile',
                        username: username
                    });
                }
            </script>
        </body>
        </html>
    `;
}

// Helper function to format time ago
function getTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y`;
}

// Helper function to get activity icon paths
function getActivityIconPath(icon: string): string {
    const iconPaths: { [key: string]: string } = {
        'git-commit': 'M10.5 7.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM8.75 7.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM10.5 9.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM8.75 9.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM10.5 11.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM8.75 11.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM10.5 13.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM8.75 13.75a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5zM2.5 2.75a.75.75 0 00-1.5 0v10.5a.75.75 0 001.5 0V2.75z',
        'git-pull-request': 'M1.5 3.25a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zm5.677-.177L9.573.677A.25.25 0 0110 .854V2.5h1A2.5 2.5 0 0113.5 5v5.628a2.251 2.251 0 101.5 0V5a4 4 0 00-4-4h-1V.854a.25.25 0 01.43-.177L7.177 3.073a.25.25 0 010 .354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm0 9.5a.75.75 0 100 1.5.75.75 0 000-1.5zm8.25.75a.75.75 0 100 1.5.75.75 0 000-1.5z',
        'issues': 'M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM1.5 1.75a.25.25 0 01.25-.25h8.5a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-3.5a.75.75 0 00-.53.22L3.5 11.44V9.25a.75.75 0 00-.75-.75h-1a.25.25 0 01-.25-.25v-5.5zM1.75 1h8.5v5.5h-2.75V9.25c0 .138.112.25.25.25h1.25l2.5 2.5v-2.5h.75v-5.5a1.75 1.75 0 00-1.75-1.75h-8.5A1.75 1.75 0 000 1.75v5.5C0 8.216.784 9 1.75 9H2.5v2.5l2.5-2.5H7.25a.25.25 0 00.25-.25V6.75h2.75V1.75z',
        'add': 'M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 110 1.5H8.5v4.25a.75.75 0 11-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z',
        'trash': 'M11 1.75a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25v.5a.25.25 0 01-.25.25h-.5v8.5a1.75 1.75 0 01-1.75 1.75h-7a1.75 1.75 0 01-1.75-1.75v-8.5h-.5a.25.25 0 01-.25-.25v-.5a.25.25 0 01.25-.25h2.5a.25.25 0 01.25.25v-.5A1.75 1.75 0 015.25 0h3.5A1.75 1.75 0 0110 1.75v.5a.25.25 0 01-.25.25h-.5zM4.5 2.75v8.5a.25.25 0 00.25.25h4.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25h-4.5a.25.25 0 00-.25.25zM6.25 3.5v6a.25.25 0 01-.5 0v-6a.25.25 0 01.5 0zm1.5 0v6a.25.25 0 01-.5 0v-6a.25.25 0 01.5 0z',
        'repo-forked': 'M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm-1.75 7.378a.75.75 0 100 1.5.75.75 0 000-1.5zm3-8.75a.75.75 0 100 1.5.75.75 0 000-1.5z',
        'star': 'M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z',
        'circle': 'M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1112 0A6 6 0 012 8z'
    };
    return iconPaths[icon] || iconPaths['circle'];
}

// Helper function to get language colors
function getLanguageColor(language: string): string {
    const colors: { [key: string]: string } = {
        'JavaScript': '#f1e05a',
        'TypeScript': '#3178c6',
        'Python': '#3572A5',
        'Java': '#b07219',
        'HTML': '#e34c26',
        'CSS': '#563d7c',
        'C': '#555555',
        'C++': '#f34b7d',
        'C#': '#239120',
        'Go': '#00ADD8',
        'Rust': '#dea584',
        'PHP': '#4F5D95',
        'Ruby': '#701516',
        'Swift': '#fa7343',
        'Kotlin': '#A97BFF',
        'Dart': '#00B4AB',
        'Scala': '#c22d40',
        'R': '#198CE7',
        'Shell': '#89e051',
        'PowerShell': '#012456',
        'Vue': '#4FC08D',
        'React': '#61DAFB'
    };
    return colors[language] || '#586069';
}

// Simple markdown parser for README
function marked(text: string): string {
    if (!text) return '';
    
    // Basic markdown parsing
    return text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`([^`]+)`/gim, '<code>$1</code>')
        .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
        .replace(/\n\n/gim, '</p><p>')
        .replace(/\n/gim, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}

export function deactivate() {}

// Helper functions
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

// Generate a nonce for Content Security Policy
function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
