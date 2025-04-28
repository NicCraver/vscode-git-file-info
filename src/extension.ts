import path from 'path'
import type { Disposable, ExtensionContext, TextEditor } from 'vscode'
import { ConfigurationTarget, StatusBarAlignment, commands, window, workspace, OutputChannel } from 'vscode'
import icons from './icons'
import { execSync } from 'child_process'

// 创建输出通道
let outputChannel: OutputChannel;

function ensureOutputChannel(): OutputChannel {
  if (!outputChannel) {
    outputChannel = window.createOutputChannel('VSCode Git File Info');
    outputChannel.show(true); // 强制显示输出通道
  }
  return outputChannel;
}

function getEnableGitBranch(): boolean {
  return workspace.getConfiguration('where-am-i').get('enableGitBranch') as boolean
}

function getEnableDebugLogs(): boolean {
  return workspace.getConfiguration('where-am-i').get('enableDebugLogs') as boolean
}

function getGitBranchColor(): string {
  return workspace.getConfiguration('where-am-i').get('gitBranchColor') as string
}

function log(message: string, data?: any) {
  // 如果未启用调试日志，则不记录
  if (!getEnableDebugLogs()) {
    return;
  }

  const channel = ensureOutputChannel();
  const timestamp = new Date().toLocaleTimeString();
  let logMessage = `[${timestamp}] ${message}`;
  
  if (data) {
    if (data instanceof Error) {
      logMessage += `\n    错误: ${data.message}`;
      if (data.stack) {
        logMessage += `\n    堆栈: ${data.stack}`;
      }
    } else {
      try {
        logMessage += `\n    数据: ${JSON.stringify(data, null, 2)}`;
      } catch (e) {
        logMessage += `\n    数据: [无法序列化]`;
      }
    }
  }
  
  channel.appendLine(logMessage);
  console.log(`[Git File Info] ${message}`);
}

type ProjectSetting = Record<string, {
  color?: string
  name?: string
  icon?: string
}>

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function getTextTransform(): string {
  return workspace.getConfiguration('where-am-i').get('textTransfrom') as string
}

function getIcon(): string {
  return workspace.getConfiguration('where-am-i').get('icon') as string
}

function alignPriority(): number {
  return +(workspace.getConfiguration('where-am-i').get('alignPriority') as string)
}

function getTemplate(): string {
  return workspace.getConfiguration('where-am-i').get('template') as string
}

function getColorful(): boolean {
  return workspace.getConfiguration('where-am-i').get('colorful') as boolean
}

function getColor(): string {
  return workspace.getConfiguration('where-am-i').get('color') as string
}

function getProjectSetting(): ProjectSetting {
  return workspace.getConfiguration('where-am-i').get('projectSetting') as ProjectSetting
}

function setProjectSetting(v: ProjectSetting) {
  workspace.getConfiguration('where-am-i').update('projectSetting', v, ConfigurationTarget.Global)
}

async function selectIcon(value?: string) {
  const items = icons.map(i => ({
    label: `$(${i})`,
    description: i,
  }))
  const result = await window.showQuickPick(items, {
    placeHolder: value,
    matchOnDetail: true,
    matchOnDescription: true,
  })
  return result?.description || value
}

function getAlign(): StatusBarAlignment {
  const align: string = workspace.getConfiguration('where-am-i').get('align') as string
  switch (align) {
    case 'left':
      return StatusBarAlignment.Left
    case 'right':
      return StatusBarAlignment.Right
    default:
      return StatusBarAlignment.Left
  }
}

function getProjectPath(): string | undefined {
  if (Array.isArray(workspace.workspaceFolders)) {
    if (workspace.workspaceFolders.length === 1) {
      return workspace.workspaceFolders[0].uri.path
    }
    else if (workspace.workspaceFolders.length > 1) {
      const activeTextEditor: TextEditor | undefined = window.activeTextEditor
      if (activeTextEditor) {
        const workspaceFolder = workspace.workspaceFolders.find((folder: any) =>
          activeTextEditor.document.uri.path.startsWith(folder.uri.path),
        )
        if (workspaceFolder)
          return workspaceFolder.uri.path
      }
    }
  }
}

function stringToColor(str: string) {
  let hash = 0
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash)

  let colour = '#'
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xFF
    colour += (`00${value.toString(16)}`).substr(-2)
  }
  return colour
}

function getProjectColor(projectName: string): string | undefined {
  if (!getColorful())
    return

  if (!projectName)
    return getColor() || undefined

  return getColor() || stringToColor(projectName)
}

const textTransforms: Record<string, (t: string) => string> = {
  uppercase: (t: string) => t.toUpperCase(),
  lowercase: (t: string) => t.toLowerCase(),
  capitalize: (t: string) => t.trim().split(/-|_/g).map(capitalize).join(' '),
}

function getProjectName(projectPath: string) {
  const projectName = path.basename(projectPath)
  const transform = getTextTransform()

  if (textTransforms[transform])
    return textTransforms[transform](projectName)
  return projectName
}

function getGitBranchName(projectPath: string): string | undefined {
  // 如果未启用Git分支功能，直接返回undefined
  if (!getEnableGitBranch()) {
    return undefined;
  }

  try {
    // 在项目路径下执行 git 命令
    log(`尝试从路径获取Git分支: ${projectPath}`);
    const branchName = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath, // 指定执行目录
      encoding: 'utf8', // 确保输出是字符串
      timeout: 1000, // 设置超时防止卡死
      stdio: ['ignore', 'pipe', 'ignore'], // 忽略 stdin, 捕获 stdout, 忽略 stderr
    }).trim(); // 去除可能存在的换行符
    log(`获取到Git分支: ${branchName}`);
    return branchName || undefined; // 如果命令成功但没有输出（例如 HEAD 分离状态），返回 undefined
  }
  catch (error) {
    log(`获取Git分支失败`, error);
    return undefined; // 命令失败（非 Git 仓库、git 未安装等）返回 undefined
  }
}

export function activate(context: ExtensionContext) {
  // 在激活时立即记录日志 - 不管是否启用调试日志，确保至少记录一次激活
  const channel = ensureOutputChannel();
  channel.appendLine(`[${new Date().toLocaleTimeString()}] 扩展激活 - VSCode Git File Info`);
  
  // 后续日志采用正常的日志函数
  log(`扩展配置加载完成`);
  
  let onDidChangeWorkspaceFoldersDisposable: Disposable | undefined
  let onDidChangeActiveTextEditorDisposable: Disposable | undefined
  let gitBranchWatcher: Disposable | undefined
  const statusBarItem = window.createStatusBarItem(getAlign(), alignPriority())
  let projectPath: string | undefined
  let projectName = ''
  let statusBarName = ''
  let statusBarColor: string | undefined
  let statusBarIcon: string | undefined
  let lastKnownBranch: string | undefined
  let branchStatusBarItem: any = null;

  // 确保输出通道被添加到订阅中
  context.subscriptions.push(ensureOutputChannel());
  
  // 添加一个命令用于显示日志
  const showLogsCommand = commands.registerCommand('vscode-git-file-info.showLogs', () => {
    ensureOutputChannel().show();
  });
  context.subscriptions.push(showLogsCommand);

  // 监听Git HEAD文件变化来检测分支变更
  function setupGitWatcher(projectPath: string) {
    // 如果未启用Git分支功能，不设置监听器
    if (!getEnableGitBranch()) {
      return;
    }

    if (gitBranchWatcher) {
      log('清理旧的Git分支监听器');
      gitBranchWatcher.dispose()
      gitBranchWatcher = undefined
    }

    try {
      const gitHeadPath = path.join(projectPath, '.git', 'HEAD')
      log(`设置Git HEAD文件监听: ${gitHeadPath}`);
      const watcher = workspace.createFileSystemWatcher(gitHeadPath)
      
      gitBranchWatcher = workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.fsPath.endsWith('.git/HEAD') || 
            e.document.uri.fsPath.endsWith('.git/refs/heads/') ||
            e.document.uri.fsPath.includes('.git/refs/heads/')) {
          log(`检测到Git文件变化: ${e.document.uri.fsPath}`);
          updateStatusBarItem()
        }
      })

      // 还要监听文件系统变化
      watcher.onDidChange(() => {
        log(`检测到Git HEAD文件变化`);
        updateStatusBarItem()
      });
      context.subscriptions.push(watcher)
      context.subscriptions.push(gitBranchWatcher)
      log('Git分支监听器设置完成');
    }
    catch (error) {
      log(`Git文件监控设置失败`, error);
      // Git文件监控设置失败 - 静默失败即可
    }
  }

  function updateStatusBarItem() {
    projectPath = getProjectPath()
    if (!projectPath) {
      log('未找到项目路径，隐藏状态栏');
      statusBarItem.text = ''
      if (branchStatusBarItem) {
        branchStatusBarItem.hide()
      }
      statusBarItem.hide()
      return
    }

    // 设置Git分支监控
    if (!gitBranchWatcher) {
      setupGitWatcher(projectPath)
    }

    const projectSetting = getProjectSetting()[projectPath] ?? {}
    projectName = projectSetting.name || getProjectName(projectPath)
    statusBarIcon = projectSetting.icon || getIcon()
    const gitBranch = getGitBranchName(projectPath)
    
    // 检测分支变化
    if (lastKnownBranch !== gitBranch) {
      log(`Git分支发生变化: ${lastKnownBranch} -> ${gitBranch}`);
      lastKnownBranch = gitBranch
    }

    // 创建主状态栏文本
    statusBarName = getTemplate()
      .replace(/{project-name}/g, projectName)
      .replace(/{icon}/g, statusBarIcon ? `$(${statusBarIcon})` : '')
      .replace(/{git-branch}/g, '') // 不再在主状态栏项目中显示Git分支

    statusBarColor = projectSetting.color || getProjectColor(projectPath)
    statusBarItem.text = statusBarName.trim()
    statusBarItem.color = statusBarColor
    statusBarItem.command = 'workbench.action.quickSwitchWindow'
    statusBarItem.show()
    
    // 创建或更新Git分支状态栏项目
    if (gitBranch && getEnableGitBranch()) {
      if (!branchStatusBarItem) {
        branchStatusBarItem = window.createStatusBarItem(getAlign(), alignPriority() - 1);
        context.subscriptions.push(branchStatusBarItem);
      }
      
      branchStatusBarItem.text = ` ${gitBranch}`;
      branchStatusBarItem.color = getGitBranchColor();
      branchStatusBarItem.show();
      log(`Git分支状态栏项目更新: ${gitBranch} (颜色: ${getGitBranchColor()})`);
    } else if (branchStatusBarItem) {
      branchStatusBarItem.hide();
    }
  }

  function updateSubscription() {
    if (!onDidChangeWorkspaceFoldersDisposable) {
      (onDidChangeWorkspaceFoldersDisposable = workspace.onDidChangeWorkspaceFolders(() => {
        updateSubscription()
        updateStatusBarItem()
      }))
    }

    if (Array.isArray(workspace.workspaceFolders)) {
      if (workspace.workspaceFolders.length > 1) {
        if (!onDidChangeActiveTextEditorDisposable)
          onDidChangeActiveTextEditorDisposable = window.onDidChangeActiveTextEditor(() => updateStatusBarItem())
      }
      else {
        if (onDidChangeActiveTextEditorDisposable)
          onDidChangeActiveTextEditorDisposable.dispose()
      }
    }
  }

  context.subscriptions.push(statusBarItem)

  commands.registerCommand('where-am-i.config', async () => {
    if (!projectName || !projectPath)
      return

    projectName = await window.showInputBox({
      value: projectName,
      prompt: 'Project Name',
    }) ?? projectName

    if (getColorful()) {
      statusBarColor = await window.showInputBox({
        value: statusBarColor,
        prompt: 'Project Color',
      }) ?? statusBarColor
    }

    statusBarIcon = await selectIcon(statusBarIcon)

    const settings = getProjectSetting()
    if (!settings[projectPath])
      settings[projectPath] = {}

    const projectSetting = settings[projectPath]
    projectSetting.name = projectName
    projectSetting.color = statusBarColor
    projectSetting.icon = statusBarIcon

    setProjectSetting(settings)
    updateStatusBarItem()
  })

  workspace.onDidChangeConfiguration(() => {
    updateSubscription()
    updateStatusBarItem()
  })

  updateSubscription()
  updateStatusBarItem()
}
